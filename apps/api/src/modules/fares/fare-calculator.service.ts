import { Inject, Injectable } from '@nestjs/common';
import {
  assertValidGeoPoint,
  computeFare,
  formatArs,
  InvalidInputError,
  isWithinBBox,
  OutOfServiceAreaError,
  resolveSeason,
  resolveTimeBand,
  SERVICE_TYPES,
  TariffNotConfiguredError,
  toLocalParts,
  type BackhaulInfo,
  type CorridorDirection,
  type FareQuote,
  type GeoPoint,
  type InterurbanMeasurement,
  type QuoteWarning,
  type ServiceType,
  type TripScope,
} from '@lacosta/domain';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { LOCALITY_RESOLVER, type CorridorStretch, type ILocalityResolver } from '../geo/locality-resolver';
import { ROUTING_PROVIDER, type IRoutingProvider } from '../routing/routing.types';
import { TARIFF_REPOSITORY, type ITariffRepository } from '../tariffs/tariff-repository';

/** Por debajo de este desplazamiento sobre RP11 no se considera que el viaje tenga sentido norte/sur. */
const DIRECTION_EPSILON_METERS = 50;
const MAX_EXTRA_WAIT_SECONDS = 3_600;

export interface FareQuoteRequest {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly serviceType: ServiceType;
  /** Espera solicitada por el pasajero (paradas intermedias), en segundos. */
  readonly extraWaitSeconds?: number;
  /**
   * USO INTERNO (no expuesto por HTTP). Instante que fija franja y temporada.
   * En una re-cotización por cambio de destino a mitad de viaje se pasa el inicio del viaje,
   * para que la franja/temporada no cambie por el solo hecho de haber pasado las 22:00.
   */
  readonly pricingInstant?: Date;
  /**
   * USO INTERNO (despacho, Fase 2). Localidad base del chofer asignado: si coincide con el destino
   * de un viaje interurbano, el Retorno Interurbano se bonifica (el chofer termina en su casa).
   */
  readonly assignedDriverBaseLocalityId?: string;
}

/**
 * Orquesta la cotización: valida → resuelve localidades (PostGIS) y ruta en paralelo → mide el tramo
 * fuera de la localidad de origen → determina alcance, franja y temporada → busca la regla del cuadro
 * vigente → delega el cálculo en el motor puro computeFare() → arma una cotización auditable.
 */
@Injectable()
export class FareCalculatorService {
  constructor(
    @Inject(LOCALITY_RESOLVER) private readonly localities: ILocalityResolver,
    @Inject(ROUTING_PROVIDER) private readonly routing: IRoutingProvider,
    @Inject(TARIFF_REPOSITORY) private readonly tariffs: ITariffRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async quote(request: FareQuoteRequest): Promise<FareQuote> {
    this.validate(request);
    const { origin, destination, serviceType } = request;
    const quotedAt = this.clock.now();
    const pricingInstant = request.pricingInstant ?? quotedAt;

    const schedule = await this.tariffs.findScheduleAt(pricingInstant);
    if (!schedule) {
      throw new TariffNotConfiguredError('No hay un cuadro tarifario aprobado vigente para el instante solicitado', {
        pricingInstant: pricingInstant.toISOString(),
      });
    }

    const [originLocality, destinationLocality, route] = await Promise.all([
      this.localities.resolve(origin),
      this.localities.resolve(destination),
      this.routing.route({ origin, destination }),
    ]);
    if (!originLocality) throw new OutOfServiceAreaError('ORIGIN', origin, 'NO_LOCALITY_NEARBY');
    if (!destinationLocality) throw new OutOfServiceAreaError('DESTINATION', destination, 'NO_LOCALITY_NEARBY');

    const stretch = await this.localities.measureCorridorStretch({
      origin,
      destination,
      originLocalityId: originLocality.id,
      routeGeometry: route.geometry,
    });

    const warnings: QuoteWarning[] = [];
    if (route.degraded) {
      warnings.push({
        code: 'ROUTING_DEGRADED',
        message: 'Ruteo vial no disponible: distancia y tiempo estimados. El cobro final se ajusta al recorrido real.',
      });
    }
    if (originLocality.method === 'NEAREST_FALLBACK') {
      warnings.push({
        code: 'ORIGIN_NEAREST_FALLBACK',
        message: `El origen está fuera de los límites urbanos; se asignó ${originLocality.name} (a ${originLocality.distanceMeters} m).`,
      });
    }
    if (destinationLocality.method === 'NEAREST_FALLBACK') {
      warnings.push({
        code: 'DESTINATION_NEAREST_FALLBACK',
        message: `El destino está fuera de los límites urbanos; se asignó ${destinationLocality.name} (a ${destinationLocality.distanceMeters} m).`,
      });
    }

    // Alcance: cruzar a otra localidad no alcanza; tiene que recorrerse un mínimo fuera del origen.
    const crossesLocality = originLocality.id !== destinationLocality.id;
    const outside = crossesLocality
      ? this.measureOutsideOrigin(stretch, route.distanceMeters)
      : { meters: 0, method: 'NOT_APPLICABLE' as const };
    const scope: TripScope =
      crossesLocality && outside.meters >= schedule.interurbanMinOutsideMeters ? 'INTERURBAN' : 'URBAN';

    if (crossesLocality && outside.method === 'CORRIDOR_PROJECTION') {
      warnings.push({
        code: 'CORRIDOR_PROJECTION_USED',
        message: 'Sin geometría de ruta: el tramo fuera de la localidad de origen se midió sobre el eje de la RP11.',
      });
    }
    if (crossesLocality && scope === 'URBAN') {
      warnings.push({
        code: 'CROSSING_BELOW_INTERURBAN_THRESHOLD',
        message: `El viaje entra en ${destinationLocality.name} solo ${outside.meters} m (umbral ${schedule.interurbanMinOutsideMeters} m): se cobra como urbano, sin retorno.`,
      });
    }

    const local = toLocalParts(pricingInstant, schedule.timeZone);
    const timeBand = resolveTimeBand(local.minuteOfDay, schedule);
    const { season, periodName } = resolveSeason(local.isoDate, await this.tariffs.findSeasonPeriodsOn(local.isoDate));

    const rule = await this.tariffs.findRule({ scheduleId: schedule.id, serviceType, scope, season, timeBand });
    if (!rule) {
      throw new TariffNotConfiguredError(`El cuadro ${schedule.code} no define tarifa para ${serviceType}/${scope}/${season}/${timeBand}`, {
        scheduleCode: schedule.code,
        serviceType,
        scope,
        season,
        timeBand,
      });
    }

    const driverEndsAtHome =
      scope === 'INTERURBAN' && request.assignedDriverBaseLocalityId !== undefined &&
      request.assignedDriverBaseLocalityId === destinationLocality.id;

    const fare = computeFare({
      rule,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      extraWaitSeconds: request.extraWaitSeconds ?? 0,
      interurbanOutsideMeters: scope === 'INTERURBAN' ? outside.meters : 0,
      returnWaived: driverEndsAtHome,
      roundingStepCents: schedule.roundingStepCents,
    });
    if (fare.metrics.returnWaived) {
      warnings.push({
        code: 'RETURN_WAIVED_DRIVER_HOME',
        message: 'Retorno Interurbano bonificado: el chofer asignado vuelve a su localidad base con este viaje.',
      });
    }

    const direction = corridorDirection(stretch.originPositionMeters, stretch.destinationPositionMeters);
    const backhaul: BackhaulInfo =
      scope === 'INTERURBAN'
        ? {
            eligible: true,
            availableFromLocalityId: destinationLocality.id,
            returnToLocalityId: originLocality.id,
            returnDirection: reverse(direction),
            returnSurchargeWaived: fare.metrics.returnWaived,
          }
        : {
            eligible: false,
            availableFromLocalityId: null,
            returnToLocalityId: null,
            returnDirection: 'NONE',
            returnSurchargeWaived: false,
          };

    return {
      quoteId: randomUUID(),
      quotedAt: quotedAt.toISOString(),
      validUntil: new Date(quotedAt.getTime() + schedule.quoteTtlSeconds * 1000).toISOString(),
      pricingInstant: pricingInstant.toISOString(),
      currency: 'ARS',
      totalCents: fare.totalCents,
      totalFormatted: formatArs(fare.totalCents),
      serviceType,
      scope,
      lines: fare.lines,
      origin: { point: { lat: origin.lat, lng: origin.lng }, locality: originLocality },
      destination: { point: { lat: destination.lat, lng: destination.lng }, locality: destinationLocality },
      corridor: {
        code: stretch.corridorCode,
        direction,
        crossedBoundaries: Math.abs(destinationLocality.corridorOrder - originLocality.corridorOrder),
        originPositionMeters: Math.round(stretch.originPositionMeters),
        destinationPositionMeters: Math.round(stretch.destinationPositionMeters),
        outsideOriginMeters: outside.meters,
        measurement: outside.method,
        interurbanThresholdMeters: schedule.interurbanMinOutsideMeters,
      },
      tariff: {
        scheduleId: schedule.id,
        scheduleCode: schedule.code,
        legalInstrument: schedule.legalInstrument,
        ruleId: rule.id,
        season,
        seasonPeriodName: periodName,
        timeBand,
        timeZone: schedule.timeZone,
      },
      route: {
        distanceMeters: Math.round(route.distanceMeters),
        durationSeconds: Math.round(route.durationSeconds),
        provider: route.provider,
        degraded: route.degraded,
      },
      backhaul,
      warnings,
    };
  }

  /**
   * Con geometría de ruta: ST_Difference(ruta, polígono origen) — preciso.
   * Sin geometría: proyección sobre el eje RP11 (subestima levemente las calles transversales;
   * el error favorece al pasajero, nunca le cobra de más).
   */
  private measureOutsideOrigin(
    stretch: CorridorStretch,
    routeDistanceMeters: number,
  ): { meters: number; method: Exclude<InterurbanMeasurement, 'NOT_APPLICABLE'> } {
    if (stretch.routeOutsideOriginMeters !== null) {
      return { meters: Math.round(clamp(stretch.routeOutsideOriginMeters, 0, routeDistanceMeters)), method: 'ROUTE_GEOMETRY' };
    }
    return { meters: Math.round(clamp(stretch.corridorOutsideOriginMeters, 0, routeDistanceMeters)), method: 'CORRIDOR_PROJECTION' };
  }

  private validate(request: FareQuoteRequest): void {
    assertValidGeoPoint(request.origin, 'origin');
    assertValidGeoPoint(request.destination, 'destination');
    if (!SERVICE_TYPES.includes(request.serviceType)) {
      throw new InvalidInputError(`serviceType inválido: ${String(request.serviceType)}`, { allowed: SERVICE_TYPES });
    }
    const wait = request.extraWaitSeconds;
    if (wait !== undefined && (!Number.isInteger(wait) || wait < 0 || wait > MAX_EXTRA_WAIT_SECONDS)) {
      throw new InvalidInputError(`extraWaitSeconds debe ser un entero entre 0 y ${MAX_EXTRA_WAIT_SECONDS}`, { extraWaitSeconds: wait });
    }
    if (request.pricingInstant !== undefined && Number.isNaN(request.pricingInstant.getTime())) {
      throw new InvalidInputError('pricingInstant inválido');
    }
    // Filtro barato antes de tocar PostGIS.
    if (!isWithinBBox(request.origin)) throw new OutOfServiceAreaError('ORIGIN', request.origin, 'OUTSIDE_DISTRICT_BBOX');
    if (!isWithinBBox(request.destination)) {
      throw new OutOfServiceAreaError('DESTINATION', request.destination, 'OUTSIDE_DISTRICT_BBOX');
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function corridorDirection(originPos: number, destinationPos: number): CorridorDirection {
  const delta = destinationPos - originPos;
  if (delta > DIRECTION_EPSILON_METERS) return 'SOUTHBOUND';
  if (delta < -DIRECTION_EPSILON_METERS) return 'NORTHBOUND';
  return 'NONE';
}

function reverse(direction: CorridorDirection): CorridorDirection {
  if (direction === 'SOUTHBOUND') return 'NORTHBOUND';
  if (direction === 'NORTHBOUND') return 'SOUTHBOUND';
  return 'NONE';
}
