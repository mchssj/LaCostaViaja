/**
 * Scripts Lua: cada uno corre ATÓMICAMENTE en Redis (nadie más ejecuta comandos en el medio).
 * Son la base de las garantías del despacho: una oferta por viaje, un viaje por chofer y un solo
 * ganador al aceptar. Todas las claves se declaran en KEYS (compatibles con Redis Cluster, Fase 6).
 */

export interface LuaScript {
  readonly numberOfKeys: number;
  readonly lua: string;
}

const BUSY = `(s == 'OFFERED' or s == 'ASSIGNED' or s == 'ON_TRIP')`;

export const LUA_SCRIPTS = {
  /** KEYS: driver, vehicleShift · ARGV: driverId, vehicleId, ...pares campo/valor */
  lcOpenShift: {
    numberOfKeys: 2,
    lua: `
local owner = redis.call('GET', KEYS[2])
if owner and owner ~= ARGV[1] then return 'VEHICLE_IN_USE' end
local d = redis.call('HMGET', KEYS[1], 'status', 'vehicleId')
local s = d[1]
if ${BUSY} then
  if d[2] == ARGV[2] then return 'ALREADY_ON_SHIFT' end
  return 'DRIVER_BUSY'
end
if s and d[2] and d[2] ~= ARGV[2] then return 'OTHER_VEHICLE' end
redis.call('SET', KEYS[2], ARGV[1])
local fields = {}
for i = 3, #ARGV do fields[#fields + 1] = ARGV[i] end
redis.call('HSET', KEYS[1], unpack(fields))
return 'OK'`,
  },

  /** KEYS: driver, vehicleShift, geo, corridor, lastseen, zoneQueue · ARGV: driverId, force */
  lcCloseShift: {
    numberOfKeys: 6,
    lua: `
local s = redis.call('HGET', KEYS[1], 'status')
if not s then return 'NOT_ON_SHIFT' end
if ARGV[2] ~= '1' and ${BUSY} then return 'BUSY' end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('ZREM', KEYS[5], ARGV[1])
redis.call('ZREM', KEYS[6], ARGV[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
redis.call('DEL', KEYS[1])
return 'OK'`,
  },

  /** KEYS: driver, offer, deadlines, lock · ARGV: tripId, driverId, offerId, deadlineMs, offerKeyTtlMs */
  lcOfferTrip: {
    numberOfKeys: 4,
    lua: `
if redis.call('EXISTS', KEYS[4]) == 1 then return 'ALREADY_TAKEN' end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'OFFER_PENDING' end
local s = redis.call('HGET', KEYS[1], 'status')
if s ~= 'AVAILABLE' and s ~= 'RETURNING' then return 'DRIVER_UNAVAILABLE' end
redis.call('HSET', KEYS[1], 'status', 'OFFERED', 'prevStatus', s, 'offerTripId', ARGV[1], 'offerId', ARGV[3], 'offerDeadline', ARGV[4])
redis.call('SET', KEYS[2], ARGV[2] .. '|' .. ARGV[3], 'PX', ARGV[5])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3])
return 'OK'`,
  },

  /** KEYS: driver, offer, lock, deadlines · ARGV: tripId, driverId, offerId, nowMs, lockTtlMs */
  lcClaimTrip: {
    numberOfKeys: 4,
    lua: `
local owner = redis.call('GET', KEYS[3])
if owner then
  if owner == ARGV[2] then return 'ALREADY_YOURS' end
  return 'ALREADY_TAKEN'
end
if redis.call('GET', KEYS[2]) ~= (ARGV[2] .. '|' .. ARGV[3]) then return 'OFFER_EXPIRED' end
local d = redis.call('HMGET', KEYS[1], 'status', 'offerTripId', 'offerId', 'offerDeadline')
if d[1] ~= 'OFFERED' or d[2] ~= ARGV[1] or d[3] ~= ARGV[3] then return 'OFFER_EXPIRED' end
if tonumber(ARGV[4]) > tonumber(d[4]) then return 'OFFER_EXPIRED' end
redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[5])
redis.call('DEL', KEYS[2])
redis.call('ZREM', KEYS[4], ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3])
redis.call('HSET', KEYS[1], 'status', 'ASSIGNED', 'tripId', ARGV[1])
redis.call('HDEL', KEYS[1], 'offerTripId', 'offerId', 'offerDeadline')
return 'OK'`,
  },

  /** Compensación si PostgreSQL rechaza la asignación. KEYS: driver, lock · ARGV: tripId, driverId */
  lcReleaseClaim: {
    numberOfKeys: 2,
    lua: `
if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
local d = redis.call('HMGET', KEYS[1], 'status', 'tripId', 'prevStatus')
if d[1] == 'ASSIGNED' and d[2] == ARGV[1] then
  local restore = d[3]
  if restore ~= 'RETURNING' then restore = 'AVAILABLE' end
  redis.call('HSET', KEYS[1], 'status', restore)
  redis.call('HDEL', KEYS[1], 'tripId')
  return 'RELEASED'
end
return 'NOOP'`,
  },

  /**
   * Rechazo, vencimiento o cancelación de una oferta.
   * KEYS: driver, offer, deadlines, rejections · ARGV: tripId, driverId, offerId, nowMs, countAsRejection, windowMs
   */
  lcRespondOffer: {
    numberOfKeys: 4,
    lua: `
local matches = redis.call('GET', KEYS[2]) == (ARGV[2] .. '|' .. ARGV[3])
if matches then redis.call('DEL', KEYS[2]) end
redis.call('ZREM', KEYS[3], ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3])
local d = redis.call('HMGET', KEYS[1], 'status', 'offerId', 'prevStatus')
if d[1] == 'OFFERED' and d[2] == ARGV[3] then
  local restore = d[3]
  if restore ~= 'RETURNING' then restore = 'AVAILABLE' end
  redis.call('HSET', KEYS[1], 'status', restore)
  redis.call('HDEL', KEYS[1], 'offerTripId', 'offerId', 'offerDeadline')
end
if matches and ARGV[5] == '1' then
  redis.call('ZADD', KEYS[4], ARGV[4], ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', tonumber(ARGV[4]) - tonumber(ARGV[6]))
  redis.call('PEXPIRE', KEYS[4], ARGV[6])
end
if matches then return 'OK' end
return 'NO_OFFER'`,
  },

  /** Toma (y quita) las ofertas vencidas: cada una la procesa una sola réplica. KEYS: deadlines · ARGV: nowMs, limit */
  lcPopExpiredOffers: {
    numberOfKeys: 1,
    lua: `
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #items > 0 then redis.call('ZREM', KEYS[1], unpack(items)) end
return items`,
  },

  /** KEYS: lease · ARGV: instanceId, ttlMs */
  lcAcquireLease: {
    numberOfKeys: 1,
    lua: `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 'ACQUIRED'
end
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 'RENEWED'
end
return 'HELD'`,
  },

  /** KEYS: lease · ARGV: instanceId */
  lcReleaseLease: {
    numberOfKeys: 1,
    lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'RELEASED'
end
return 'NOOP'`,
  },

  /** KEYS: driver · ARGV: tripId */
  lcToOnTrip: {
    numberOfKeys: 1,
    lua: `
local d = redis.call('HMGET', KEYS[1], 'status', 'tripId')
if d[2] ~= ARGV[1] then return 'INVALID' end
if d[1] == 'ASSIGNED' then
  redis.call('HSET', KEYS[1], 'status', 'ON_TRIP')
  return 'OK'
end
if d[1] == 'ON_TRIP' then return 'OK' end
return 'INVALID'`,
  },

  /**
   * Fin del viaje: AVAILABLE o RETURNING (Viaje de Vuelta).
   * KEYS: driver, lock · ARGV: tripId, driverId, newStatus, nowMs, returnToLocalityId, returnDirection, returningUntil
   */
  lcReleaseAfterTrip: {
    numberOfKeys: 2,
    lua: `
local d = redis.call('HMGET', KEYS[1], 'status', 'tripId')
if (d[1] ~= 'ASSIGNED' and d[1] ~= 'ON_TRIP') or d[2] ~= ARGV[1] then return 'INVALID' end
if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
redis.call('HDEL', KEYS[1], 'tripId', 'prevStatus', 'returnToLocalityId', 'returnDirection', 'returningUntil')
redis.call('HSET', KEYS[1], 'status', ARGV[3], 'availableSince', ARGV[4])
if ARGV[3] == 'RETURNING' then
  redis.call('HSET', KEYS[1], 'returnToLocalityId', ARGV[5], 'returnDirection', ARGV[6], 'returningUntil', ARGV[7])
end
return 'OK'`,
  },

  /** Llegó a su base o venció el Viaje de Vuelta. KEYS: driver */
  lcEndReturning: {
    numberOfKeys: 1,
    lua: `
local d = redis.call('HMGET', KEYS[1], 'status', 'prevStatus')
if d[1] == 'RETURNING' then
  redis.call('HSET', KEYS[1], 'status', 'AVAILABLE')
  redis.call('HDEL', KEYS[1], 'returnToLocalityId', 'returnDirection', 'returningUntil')
  return 'OK'
end
if d[1] == 'OFFERED' and d[2] == 'RETURNING' then
  redis.call('HSET', KEYS[1], 'prevStatus', 'AVAILABLE')
  redis.call('HDEL', KEYS[1], 'returnToLocalityId', 'returnDirection', 'returningUntil')
  return 'OK'
end
return 'NOOP'`,
  },
} as const satisfies Record<string, LuaScript>;

export type LuaScriptName = keyof typeof LUA_SCRIPTS;
