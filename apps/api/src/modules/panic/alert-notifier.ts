import { Injectable, Logger } from '@nestjs/common';

export const ALERT_NOTIFIER = Symbol('ALERT_NOTIFIER');

export interface EscalatedAlert {
  readonly id: string;
  readonly tripPublicCode: string | null;
  readonly raisedBy: string;
  readonly lat: number;
  readonly lng: number;
  readonly escalationCount: number;
  readonly receivedAt: string;
}

/**
 * Canal externo para alertas que nadie atendió a tiempo (SMS / llamada a guardia, a definir con el
 * municipio). Se implementa esta interfaz cuando se elija el proveedor.
 */
export interface IAlertNotifier {
  readonly name: string;
  notifyEscalation(alert: EscalatedAlert): Promise<void>;
}

/** Desarrollo: deja constancia en el log con nivel de error para que se vea. */
@Injectable()
export class LogAlertNotifier implements IAlertNotifier {
  readonly name = 'log';
  private readonly logger = new Logger('AlertaCOM');

  async notifyEscalation(a: EscalatedAlert): Promise<void> {
    this.logger.error(
      `ALERTA SIN ATENDER #${a.escalationCount}: ${a.id} (viaje ${a.tripPublicCode ?? '—'}, ${a.raisedBy}) en ${a.lat.toFixed(5)},${a.lng.toFixed(5)}`,
    );
  }
}
