import type { CorridorDirection } from './enums';
import { InvalidInputError } from './errors';

/**
 * Ranking de candidatos para una oferta. Puro y determinístico: el mismo estado produce siempre
 * el mismo orden, lo que hace auditable cada decisión (el desglose se guarda en trip_offers).
 *
 * Puntaje en "segundos equivalentes" (menor = mejor):
 *   ETA + penalización por rechazos recientes − bonificaciones (Viaje de Vuelta, cola de parada, espera).
 */

export interface CandidateBackhaul {
  /** Localidad base a la que el chofer está volviendo. */
  readonly baseLocalityId: string;
  readonly returnDirection: CorridorDirection;
}

export interface DispatchCandidate {
  readonly driverId: string;
  readonly vehicleId: string;
  readonly etaSeconds: number;
  /** Distancia sobre el corredor al origen (informativa). */
  readonly corridorDistanceMeters: number;
  /** Tiempo disponible sin viaje. */
  readonly idleSeconds: number;
  /** Rechazos y vencimientos en la ventana reciente. */
  readonly recentRejections: number;
  /** Posición en la cola de la parada del origen (0 = primero); null si no está en esa cola. */
  readonly queuePosition: number | null;
  /** Presente solo si el chofer está en estado RETURNING. */
  readonly backhaul: CandidateBackhaul | null;
}

export interface DispatchTripContext {
  readonly destinationLocalityId: string;
  /** Sentido del viaje sobre RP11. */
  readonly direction: CorridorDirection;
}

export interface RankingWeights {
  readonly rejectionPenaltySeconds: number;
  readonly maxPenalizedRejections: number;
  /** El viaje va en el sentido de vuelta del chofer. */
  readonly backhaulDirectionBonusSeconds: number;
  /** El viaje termina en la localidad base del chofer. */
  readonly backhaulHomeBonusSeconds: number;
  readonly queueHeadBonusSeconds: number;
  readonly queueBonusDecayPerPositionSeconds: number;
  readonly idleBonusPerMinuteSeconds: number;
  readonly maxIdleBonusSeconds: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  rejectionPenaltySeconds: 60,
  maxPenalizedRejections: 5,
  backhaulDirectionBonusSeconds: 300,
  backhaulHomeBonusSeconds: 600,
  queueHeadBonusSeconds: 120,
  queueBonusDecayPerPositionSeconds: 30,
  idleBonusPerMinuteSeconds: 2,
  maxIdleBonusSeconds: 60,
};

export type BackhaulMatch = 'HOME' | 'DIRECTION' | null;

export interface ScoreBreakdown {
  readonly etaSeconds: number;
  readonly rejectionPenaltySeconds: number;
  readonly backhaulBonusSeconds: number;
  readonly queueBonusSeconds: number;
  readonly idleBonusSeconds: number;
}

export interface RankedCandidate extends DispatchCandidate {
  readonly scoreSeconds: number;
  readonly backhaulMatch: BackhaulMatch;
  readonly breakdown: ScoreBreakdown;
}

/** ¿Este viaje le sirve al chofer para volver? HOME si termina en su base; DIRECTION si va en su sentido. */
export function backhaulMatch(backhaul: CandidateBackhaul | null, trip: DispatchTripContext): BackhaulMatch {
  if (!backhaul) return null;
  if (backhaul.baseLocalityId === trip.destinationLocalityId) return 'HOME';
  if (trip.direction !== 'NONE' && trip.direction === backhaul.returnDirection) return 'DIRECTION';
  return null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  trip: DispatchTripContext,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankedCandidate[] {
  const ranked = candidates.map((c): RankedCandidate => {
    if (!Number.isFinite(c.etaSeconds) || c.etaSeconds < 0) {
      throw new InvalidInputError(`ETA inválido para el chofer ${c.driverId}`, { etaSeconds: c.etaSeconds });
    }
    const match = backhaulMatch(c.backhaul, trip);
    const breakdown: ScoreBreakdown = {
      etaSeconds: round1(c.etaSeconds),
      rejectionPenaltySeconds: Math.min(Math.max(0, c.recentRejections), weights.maxPenalizedRejections) * weights.rejectionPenaltySeconds,
      backhaulBonusSeconds:
        match === 'HOME' ? weights.backhaulHomeBonusSeconds : match === 'DIRECTION' ? weights.backhaulDirectionBonusSeconds : 0,
      queueBonusSeconds:
        c.queuePosition === null
          ? 0
          : Math.max(0, weights.queueHeadBonusSeconds - c.queuePosition * weights.queueBonusDecayPerPositionSeconds),
      idleBonusSeconds: round1(Math.min(weights.maxIdleBonusSeconds, (Math.max(0, c.idleSeconds) / 60) * weights.idleBonusPerMinuteSeconds)),
    };
    const scoreSeconds = round1(
      breakdown.etaSeconds +
        breakdown.rejectionPenaltySeconds -
        breakdown.backhaulBonusSeconds -
        breakdown.queueBonusSeconds -
        breakdown.idleBonusSeconds,
    );
    return { ...c, scoreSeconds, backhaulMatch: match, breakdown };
  });
  return ranked.sort(
    (a, b) => a.scoreSeconds - b.scoreSeconds || a.etaSeconds - b.etaSeconds || a.driverId.localeCompare(b.driverId),
  );
}
