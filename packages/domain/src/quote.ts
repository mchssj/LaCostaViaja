import type {
  CorridorDirection,
  InterurbanMeasurement,
  LocalityResolutionMethod,
  Season,
  ServiceType,
  TimeBand,
  TripScope,
} from './enums';
import type { FareLineItem } from './fare-engine';
import type { GeoPoint } from './geo';

export interface LocalityRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** 1 = extremo norte del corredor. */
  readonly corridorOrder: number;
}

export interface ResolvedLocality extends LocalityRef {
  readonly method: LocalityResolutionMethod;
  /** 0 si el punto cae dentro del polígono. */
  readonly distanceMeters: number;
}

export type QuoteWarningCode =
  | 'ROUTING_DEGRADED'
  | 'ORIGIN_NEAREST_FALLBACK'
  | 'DESTINATION_NEAREST_FALLBACK'
  | 'CORRIDOR_PROJECTION_USED'
  | 'CROSSING_BELOW_INTERURBAN_THRESHOLD'
  | 'RETURN_WAIVED_DRIVER_HOME';

export interface QuoteWarning {
  readonly code: QuoteWarningCode;
  readonly message: string;
}

export interface CorridorInfo {
  readonly code: string;
  readonly direction: CorridorDirection;
  /** Límites de localidad atravesados sobre el corredor (|orden destino − orden origen|). */
  readonly crossedBoundaries: number;
  readonly originPositionMeters: number;
  readonly destinationPositionMeters: number;
  readonly outsideOriginMeters: number;
  readonly measurement: InterurbanMeasurement;
  readonly interurbanThresholdMeters: number;
}

/** Datos para que el despacho (Fase 2) priorice el Viaje de Vuelta del chofer. */
export interface BackhaulInfo {
  /** Al completar este viaje, el chofer queda fuera de su zona y es candidato prioritario de vuelta. */
  readonly eligible: boolean;
  /** Localidad donde el chofer queda disponible al terminar. */
  readonly availableFromLocalityId: string | null;
  /** Localidad hacia la que tiene que volver. */
  readonly returnToLocalityId: string | null;
  readonly returnDirection: CorridorDirection;
  /** Se bonificó el retorno porque el chofer asignado termina en su base. */
  readonly returnSurchargeWaived: boolean;
}

export interface FareQuote {
  readonly quoteId: string;
  readonly quotedAt: string;
  readonly validUntil: string;
  /** Instante que fijó franja horaria y temporada. */
  readonly pricingInstant: string;
  readonly currency: 'ARS';
  readonly totalCents: number;
  readonly totalFormatted: string;
  readonly serviceType: ServiceType;
  readonly scope: TripScope;
  readonly lines: readonly FareLineItem[];
  readonly origin: { readonly point: GeoPoint; readonly locality: ResolvedLocality };
  readonly destination: { readonly point: GeoPoint; readonly locality: ResolvedLocality };
  readonly corridor: CorridorInfo;
  readonly tariff: {
    readonly scheduleId: string;
    readonly scheduleCode: string;
    readonly legalInstrument: string;
    readonly ruleId: string;
    readonly season: Season;
    readonly seasonPeriodName: string | null;
    readonly timeBand: TimeBand;
    readonly timeZone: string;
  };
  readonly route: {
    readonly distanceMeters: number;
    readonly durationSeconds: number;
    readonly provider: string;
    readonly degraded: boolean;
  };
  readonly backhaul: BackhaulInfo;
  readonly warnings: readonly QuoteWarning[];
}
