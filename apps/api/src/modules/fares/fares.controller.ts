import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FareQuote } from '@lacosta/domain';
import { Public } from '../../security/principal';
import { QuoteTokenService } from '../../security/quote-token.service';
import { RateLimit } from '../../security/rate-limit';
import { QuoteFareDto } from './dto/quote-fare.dto';
import { FareCalculatorService } from './fare-calculator.service';

@ApiTags('tarifas')
@Controller({ path: 'fares', version: '1' })
export class FaresController {
  constructor(
    private readonly fares: FareCalculatorService,
    private readonly quoteTokens: QuoteTokenService,
  ) {}

  /**
   * Tarifa cerrada y desglosada antes de confirmar (pública: la PWA cotiza antes de tener sesión).
   * Devuelve quoteToken: al crear el viaje con él, el precio queda garantizado hasta validUntil.
   */
  @Public()
  @RateLimit({ name: 'quote', limit: 60, windowSeconds: 60, by: 'ip' })
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  async quote(@Body() dto: QuoteFareDto): Promise<FareQuote & { quoteToken: string }> {
    const quote = await this.fares.quote({
      origin: { lat: dto.origin.lat, lng: dto.origin.lng },
      destination: { lat: dto.destination.lat, lng: dto.destination.lng },
      serviceType: dto.serviceType,
      ...(dto.extraWaitSeconds !== undefined ? { extraWaitSeconds: dto.extraWaitSeconds } : {}),
    });
    return { ...quote, quoteToken: this.quoteTokens.sign(quote) };
  }
}
