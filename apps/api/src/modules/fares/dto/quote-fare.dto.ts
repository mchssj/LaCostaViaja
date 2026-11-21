import { SERVICE_TYPES, type ServiceType } from '@lacosta/domain';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class GeoPointDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

/**
 * Cuerpo público de POST /api/v1/fares/quote.
 * pricingInstant y assignedDriverBaseLocalityId NO se aceptan desde afuera (forbidNonWhitelisted):
 * son parámetros internos del despacho y permitirían manipular franja o bonificaciones.
 */
export class QuoteFareDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointDto)
  origin!: GeoPointDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointDto)
  destination!: GeoPointDto;

  @IsIn(SERVICE_TYPES)
  serviceType!: ServiceType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  extraWaitSeconds?: number;
}
