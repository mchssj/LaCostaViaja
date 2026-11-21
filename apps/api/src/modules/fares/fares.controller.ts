import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { FareQuote } from '@lacosta/domain';
import { QuoteFareDto } from './dto/quote-fare.dto';
import { FareCalculatorService } from './fare-calculator.service';

@Controller({ path: 'fares', version: '1' })
export class FaresController {
  constructor(private readonly fares: FareCalculatorService) {}

  /** Tarifa cerrada y desglosada antes de confirmar el viaje (app, PWA Modo Invitado, operador). */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Body() dto: QuoteFareDto): Promise<FareQuote> {
    return this.fares.quote({
      origin: { lat: dto.origin.lat, lng: dto.origin.lng },
      destination: { lat: dto.destination.lat, lng: dto.destination.lng },
      serviceType: dto.serviceType,
      ...(dto.extraWaitSeconds !== undefined ? { extraWaitSeconds: dto.extraWaitSeconds } : {}),
    });
  }
}
