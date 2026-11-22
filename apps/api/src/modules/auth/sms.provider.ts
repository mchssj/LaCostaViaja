import { Injectable, Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Proveedor de SMS (a definir con el municipio). */
export interface ISmsProvider {
  readonly name: string;
  send(phone: string, message: string): Promise<void>;
}

/**
 * Desarrollo: escribe el mensaje en el log. NO usar en producción (el código quedaría en los logs):
 * cuando se elija el proveedor real se implementa esta misma interfaz.
 */
@Injectable()
export class LogSmsProvider implements ISmsProvider {
  readonly name = 'log';
  private readonly logger = new Logger('SMS');

  async send(phone: string, message: string): Promise<void> {
    this.logger.warn(`[SOLO DESARROLLO] SMS a ${phone}: ${message}`);
  }
}
