import { Inject, Injectable } from '@nestjs/common';
import type { CorridorDirection, DriverPresenceStatus, GeoPoint, GpsPing, ServiceType } from '@lacosta/domain';
import type Redis from 'ioredis';
import type { LuaScriptName } from './lua-scripts';
import { deadlineMember, parseDeadlineMember, RK } from './redis.keys';
import { REDIS } from './redis.tokens';

/** Estado de un chofer en turno, tal como vive en el HASH lc:driver:{id}. */
export interface DriverState {
  readonly driverId: string;
  readonly status: DriverPresenceStatus;
  readonly prevStatus: DriverPresenceStatus | null;
  readonly vehicleId: string;
  readonly serviceType: ServiceType;
  readonly baseLocalityId: string;
  readonly acceptsInterurban: boolean;
  readonly position: (GeoPoint & { readonly recordedAt: number; readonly accuracyM: number | null }) | null;
  readonly corridorPositionMeters: number | null;
  readonly localityId: string | null;
  readonly zoneId: string | null;
  readonly availableSince: number | null;
  readonly lastSeenAt: number | null;
  readonly tripId: string | null;
  readonly offerTripId: string | null;
  readonly offerId: string | null;
  readonly offerDeadline: number | null;
  readonly returnToLocalityId: string | null;
  readonly returnDirection: CorridorDirection | null;
  readonly returningUntil: number | null;
  readonly eligibleCheckedAt: number | null;
  readonly shiftStartedAt: number | null;
  readonly suspiciousJumps: number;
}

export interface PositionUpdate {
  readonly lat: number;
  readonly lng: number;
  readonly recordedAt: number;
  readonly accuracyM: number | null;
  readonly corridorPositionMeters: number;
  readonly localityId: string | null;
  readonly zoneId: string | null;
}

export interface TrackEntry extends GpsPing {
  readonly tripId: string;
  readonly driverId: string;
}

export type OpenShiftResult = 'OK' | 'VEHICLE_IN_USE' | 'ALREADY_ON_SHIFT' | 'DRIVER_BUSY' | 'OTHER_VEHICLE';
export type OfferResult = 'OK' | 'ALREADY_TAKEN' | 'OFFER_PENDING' | 'DRIVER_UNAVAILABLE';
export type ClaimResult = 'OK' | 'ALREADY_YOURS' | 'ALREADY_TAKEN' | 'OFFER_EXPIRED';
export type LeaseResult = 'ACQUIRED' | 'RENEWED' | 'HELD';

const num = (v: string | undefined): number | null => (v === undefined || v === '' ? null : Number(v));
const str = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);

function parseDriver(driverId: string, h: Record<string, string>): DriverState | null {
  if (!h['status']) return null;
  const lat = num(h['lat']);
  const lng = num(h['lng']);
  const recordedAt = num(h['recordedAt']);
  return {
    driverId,
    status: h['status'] as DriverPresenceStatus,
    prevStatus: (str(h['prevStatus']) as DriverPresenceStatus | null) ?? null,
    vehicleId: h['vehicleId'] ?? '',
    serviceType: h['serviceType'] as ServiceType,
    baseLocalityId: h['baseLocalityId'] ?? '',
    acceptsInterurban: h['acceptsInterurban'] !== '0',
    position:
      lat !== null && lng !== null && recordedAt !== null ? { lat, lng, recordedAt, accuracyM: num(h['accuracyM']) } : null,
    corridorPositionMeters: num(h['corridorPos']),
    localityId: str(h['localityId']),
    zoneId: str(h['zoneId']),
    availableSince: num(h['availableSince']),
    lastSeenAt: num(h['lastSeenAt']),
    tripId: str(h['tripId']),
    offerTripId: str(h['offerTripId']),
    offerId: str(h['offerId']),
    offerDeadline: num(h['offerDeadline']),
    returnToLocalityId: str(h['returnToLocalityId']),
    returnDirection: (str(h['returnDirection']) as CorridorDirection | null) ?? null,
    returningUntil: num(h['returningUntil']),
    eligibleCheckedAt: num(h['eligibleCheckedAt']),
    shiftStartedAt: num(h['shiftStartedAt']),
    suspiciousJumps: num(h['suspiciousJumps']) ?? 0,
  };
}

const SEARCHABLE: readonly DriverPresenceStatus[] = ['AVAILABLE', 'RETURNING', 'OFFERED'];

/** Acceso tipado a todo el estado en tiempo real de Redis (presencia, colas, ofertas, locks, recorrido). */
@Injectable()
export class RedisStateStore {
  constructor(@Inject(REDIS) readonly redis: Redis) {}

  private async script<T>(name: LuaScriptName, keys: readonly string[], args: ReadonlyArray<string | number>): Promise<T> {
    const fn = (this.redis as unknown as Record<string, (...a: Array<string | number>) => Promise<unknown>>)[name];
    if (!fn) throw new Error(`Script Lua ${name} no registrado`);
    return (await fn.call(this.redis, ...keys, ...args)) as T;
  }

  private static async exec(m: ReturnType<Redis['multi']>): Promise<unknown[]> {
    const results = (await m.exec()) ?? [];
    const failed = results.find(([err]) => err);
    if (failed?.[0]) throw failed[0];
    return results.map(([, value]) => value);
  }

  // ---------------------------------------------------------------- presencia

  async getDriver(driverId: string): Promise<DriverState | null> {
    return parseDriver(driverId, await this.redis.hgetall(RK.driver(driverId)));
  }

  async getDrivers(driverIds: readonly string[]): Promise<DriverState[]> {
    if (driverIds.length === 0) return [];
    const p = this.redis.pipeline();
    for (const id of driverIds) p.hgetall(RK.driver(id));
    const results = (await p.exec()) ?? [];
    return driverIds
      .map((id, i) => parseDriver(id, (results[i]?.[1] as Record<string, string> | undefined) ?? {}))
      .filter((s): s is DriverState => s !== null);
  }

  openShift(driverId: string, vehicleId: string, fields: Record<string, string | number>): Promise<OpenShiftResult> {
    const pairs = Object.entries(fields).flatMap(([k, v]) => [k, String(v)]);
    return this.script<OpenShiftResult>('lcOpenShift', [RK.driver(driverId), RK.vehicleShift(vehicleId)], [driverId, vehicleId, ...pairs]);
  }

  closeShift(state: DriverState, force: boolean): Promise<'OK' | 'BUSY' | 'NOT_ON_SHIFT'> {
    return this.script('lcCloseShift', [
      RK.driver(state.driverId),
      RK.vehicleShift(state.vehicleId),
      RK.geo(state.serviceType),
      RK.corridor(state.serviceType),
      RK.lastSeen,
      RK.zoneQueue(state.zoneId),
    ], [state.driverId, force ? '1' : '0']);
  }

  async setDriverFields(driverId: string, fields: Record<string, string | number>): Promise<void> {
    await this.redis.hset(RK.driver(driverId), fields);
  }

  /** Aplica un ping (o solo la señal de vida) y mantiene índices y cola de parada en una transacción. */
  async applyPosition(state: DriverState, update: PositionUpdate | null, nowMs: number, suspiciousJumps: number): Promise<void> {
    const id = state.driverId;
    const key = RK.driver(id);
    const m = this.redis.multi();
    m.hset(key, 'lastSeenAt', nowMs);
    if (suspiciousJumps > 0) m.hincrby(key, 'suspiciousJumps', suspiciousJumps);
    m.zadd(RK.lastSeen, nowMs, id);
    if (update) {
      m.hset(key, {
        lat: update.lat,
        lng: update.lng,
        recordedAt: update.recordedAt,
        accuracyM: update.accuracyM ?? '',
        corridorPos: Math.round(update.corridorPositionMeters),
        localityId: update.localityId ?? '',
        zoneId: update.zoneId ?? '',
      });
      if (state.zoneId && state.zoneId !== update.zoneId) m.zrem(RK.zoneQueue(state.zoneId), id);
      if (SEARCHABLE.includes(state.status)) {
        m.geoadd(RK.geo(state.serviceType), update.lng, update.lat, id);
        m.zadd(RK.corridor(state.serviceType), Math.round(update.corridorPositionMeters), id);
        // NX: los pings siguientes no le hacen perder el lugar en la cola de la parada.
        if (update.zoneId) m.zadd(RK.zoneQueue(update.zoneId), 'NX', nowMs, id);
      } else {
        m.zrem(RK.geo(state.serviceType), id);
        m.zrem(RK.corridor(state.serviceType), id);
        if (update.zoneId) m.zrem(RK.zoneQueue(update.zoneId), id);
      }
    }
    await RedisStateStore.exec(m);
  }

  /** Vuelve a indexar al chofer en su última posición (al quedar disponible tras un viaje). */
  async reindex(state: DriverState, nowMs: number): Promise<void> {
    if (!state.position || state.corridorPositionMeters === null) return;
    const m = this.redis.multi();
    m.geoadd(RK.geo(state.serviceType), state.position.lng, state.position.lat, state.driverId);
    m.zadd(RK.corridor(state.serviceType), state.corridorPositionMeters, state.driverId);
    if (state.zoneId) m.zadd(RK.zoneQueue(state.zoneId), 'NX', nowMs, state.driverId);
    await RedisStateStore.exec(m);
  }

  /** Saca al chofer de los índices de búsqueda (asignado / en viaje). */
  async unindex(state: DriverState): Promise<void> {
    const m = this.redis.multi();
    m.zrem(RK.geo(state.serviceType), state.driverId);
    m.zrem(RK.corridor(state.serviceType), state.driverId);
    if (state.zoneId) m.zrem(RK.zoneQueue(state.zoneId), state.driverId);
    await RedisStateStore.exec(m);
  }

  toOnTrip(driverId: string, tripId: string): Promise<'OK' | 'INVALID'> {
    return this.script('lcToOnTrip', [RK.driver(driverId)], [tripId]);
  }

  releaseAfterTrip(
    driverId: string,
    tripId: string,
    nowMs: number,
    backhaul: { returnToLocalityId: string; returnDirection: CorridorDirection; returningUntil: number } | null,
  ): Promise<'OK' | 'INVALID'> {
    return this.script('lcReleaseAfterTrip', [RK.driver(driverId), RK.lock(tripId)], [
      tripId,
      driverId,
      backhaul ? 'RETURNING' : 'AVAILABLE',
      nowMs,
      backhaul?.returnToLocalityId ?? '',
      backhaul?.returnDirection ?? '',
      backhaul?.returningUntil ?? '',
    ]);
  }

  endReturning(driverId: string): Promise<'OK' | 'NOOP'> {
    return this.script('lcEndReturning', [RK.driver(driverId)], []);
  }

  /** Choferes cuyo último ping es anterior a cutoffMs. */
  staleDriverIds(cutoffMs: number, limit = 500): Promise<string[]> {
    return this.redis.zrangebyscore(RK.lastSeen, '-inf', cutoffMs, 'LIMIT', 0, limit);
  }

  // ---------------------------------------------------------------- búsqueda de candidatos

  /** Unión de: cola de la parada, ventana sobre el corredor y búsqueda geográfica acotada. */
  async candidateIds(params: {
    service: ServiceType;
    origin: GeoPoint;
    corridorPositionMeters: number;
    corridorWindowMeters: number;
    geoRadiusMeters: number;
    zoneId: string | null;
    limitPerSource: number;
  }): Promise<string[]> {
    const p = this.redis.pipeline();
    p.zrange(RK.zoneQueue(params.zoneId), 0, params.limitPerSource - 1);
    p.zrangebyscore(
      RK.corridor(params.service),
      params.corridorPositionMeters - params.corridorWindowMeters,
      params.corridorPositionMeters + params.corridorWindowMeters,
      'LIMIT',
      0,
      params.limitPerSource,
    );
    p.geosearch(
      RK.geo(params.service),
      'FROMLONLAT',
      params.origin.lng,
      params.origin.lat,
      'BYRADIUS',
      params.geoRadiusMeters,
      'm',
      'ASC',
      'COUNT',
      params.limitPerSource,
    );
    const results = (await p.exec()) ?? [];
    const ids = new Set<string>();
    for (const [err, value] of results) {
      if (err) throw err;
      for (const id of (value as string[] | null) ?? []) ids.add(id);
    }
    return [...ids];
  }

  async queuePositions(zoneId: string | null, driverIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!zoneId || driverIds.length === 0) return out;
    const p = this.redis.pipeline();
    for (const id of driverIds) p.zrank(RK.zoneQueue(zoneId), id);
    const results = (await p.exec()) ?? [];
    driverIds.forEach((id, i) => {
      const rank = results[i]?.[1];
      if (typeof rank === 'number') out.set(id, rank);
    });
    return out;
  }

  async recentRejections(driverIds: readonly string[], sinceMs: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (driverIds.length === 0) return out;
    const p = this.redis.pipeline();
    for (const id of driverIds) p.zcount(RK.rejections(id), sinceMs, '+inf');
    const results = (await p.exec()) ?? [];
    driverIds.forEach((id, i) => out.set(id, Number(results[i]?.[1] ?? 0)));
    return out;
  }

  // ---------------------------------------------------------------- ofertas y lock

  offerTrip(tripId: string, driverId: string, offerId: string, deadlineMs: number, offerKeyTtlMs: number): Promise<OfferResult> {
    return this.script('lcOfferTrip', [RK.driver(driverId), RK.offer(tripId), RK.deadlines, RK.lock(tripId)], [
      tripId,
      driverId,
      offerId,
      deadlineMs,
      offerKeyTtlMs,
    ]);
  }

  async currentOffer(tripId: string): Promise<{ driverId: string; offerId: string } | null> {
    const raw = await this.redis.get(RK.offer(tripId));
    if (!raw) return null;
    const [driverId, offerId] = raw.split('|');
    return driverId && offerId ? { driverId, offerId } : null;
  }

  tripLockOwner(tripId: string): Promise<string | null> {
    return this.redis.get(RK.lock(tripId));
  }

  claimTrip(tripId: string, driverId: string, offerId: string, nowMs: number, lockTtlMs: number): Promise<ClaimResult> {
    return this.script('lcClaimTrip', [RK.driver(driverId), RK.offer(tripId), RK.lock(tripId), RK.deadlines], [
      tripId,
      driverId,
      offerId,
      nowMs,
      lockTtlMs,
    ]);
  }

  releaseClaim(tripId: string, driverId: string): Promise<'RELEASED' | 'NOOP'> {
    return this.script('lcReleaseClaim', [RK.driver(driverId), RK.lock(tripId)], [tripId, driverId]);
  }

  respondOffer(
    tripId: string,
    driverId: string,
    offerId: string,
    nowMs: number,
    countAsRejection: boolean,
    rejectionWindowMs: number,
  ): Promise<'OK' | 'NO_OFFER'> {
    return this.script('lcRespondOffer', [RK.driver(driverId), RK.offer(tripId), RK.deadlines, RK.rejections(driverId)], [
      tripId,
      driverId,
      offerId,
      nowMs,
      countAsRejection ? '1' : '0',
      rejectionWindowMs,
    ]);
  }

  async popExpiredOffers(nowMs: number, limit = 100): Promise<Array<{ tripId: string; driverId: string; offerId: string }>> {
    const members = await this.script<string[]>('lcPopExpiredOffers', [RK.deadlines], [nowMs, limit]);
    return members.map(parseDeadlineMember).filter((m): m is NonNullable<typeof m> => m !== null);
  }

  /** Solo para tests y herramientas: el miembro que corresponde a una oferta. */
  static deadlineMember = deadlineMember;

  acquireLease(tripId: string, instanceId: string, ttlMs: number): Promise<LeaseResult> {
    return this.script('lcAcquireLease', [RK.lease(tripId)], [instanceId, ttlMs]);
  }

  releaseLease(tripId: string, instanceId: string): Promise<'RELEASED' | 'NOOP'> {
    return this.script('lcReleaseLease', [RK.lease(tripId)], [instanceId]);
  }

  // ---------------------------------------------------------------- recorrido

  async appendTrack(entries: readonly TrackEntry[], maxLen: number): Promise<void> {
    if (entries.length === 0) return;
    const p = this.redis.pipeline();
    for (const e of entries) {
      p.xadd(
        RK.track,
        'MAXLEN',
        '~',
        maxLen,
        '*',
        'tripId', e.tripId,
        'driverId', e.driverId,
        't', e.recordedAt,
        'lat', e.lat,
        'lng', e.lng,
        's', e.speedKmh ?? '',
        'h', e.headingDeg ?? '',
        'a', e.accuracyM ?? '',
      );
    }
    const results = (await p.exec()) ?? [];
    const failed = results.find(([err]) => err);
    if (failed?.[0]) throw failed[0];
  }
}
