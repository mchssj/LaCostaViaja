import { Catch, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { DomainError, type DomainErrorCode } from '@lacosta/domain';
import type { Response } from 'express';

const STATUS_BY_CODE: Record<DomainErrorCode, HttpStatus> = {
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  OUT_OF_SERVICE_AREA: HttpStatus.UNPROCESSABLE_ENTITY,
  TARIFF_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  ROUTING_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  DRIVER_NOT_ELIGIBLE: HttpStatus.FORBIDDEN,
  DRIVER_NOT_ON_SHIFT: HttpStatus.CONFLICT,
  DISPATCH_CONFLICT: HttpStatus.CONFLICT,
  SERVICE_DEGRADED: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Traduce errores de dominio a HTTP con un cuerpo estable { error, message, details }. */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const status = STATUS_BY_CODE[exception.code];
    if (status >= 500) this.logger.error(`${exception.code}: ${exception.message}`);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ error: exception.code, message: exception.message, details: exception.details });
  }
}
