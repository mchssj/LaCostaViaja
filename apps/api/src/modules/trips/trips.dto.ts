import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_METHODS, SERVICE_TYPES, type PaymentMethod, type ServiceType } from '@lacosta/domain';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class PointDto {
  @ApiProperty({ example: -36.6875 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat!: number;
  @ApiProperty({ example: -56.68 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng!: number;
}

export class CreateTripDto {
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) origin!: PointDto;
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) destination!: PointDto;
  @ApiPropertyOptional({ enum: SERVICE_TYPES, default: 'TAXI' }) @IsOptional() @IsIn(SERVICE_TYPES) serviceType?: ServiceType;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'CASH' }) @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional({ description: 'Obligatorio con VOUCHER o MUNICIPAL_ACCOUNT' }) @IsOptional() @Matches(/^[A-Z0-9-]{6,32}$/) voucherCode?: string;
  @ApiPropertyOptional({ description: 'quoteToken de POST /fares/quote: garantiza el precio cotizado' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  quoteToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) originAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) destinationAddress?: string;
  @ApiPropertyOptional({ description: 'Ignorado: el canal sale del tipo de sesión' }) @IsOptional() @IsString() @MaxLength(40) channel?: string;
}

export class TripActionDto {
  @ApiPropertyOptional({ description: 'Id del evento en el dispositivo: un reintento no se aplica dos veces' })
  @IsOptional()
  @IsUUID()
  clientEventId?: string;
  @ApiPropertyOptional({ type: PointDto }) @IsOptional() @ValidateNested() @Type(() => PointDto) location?: PointDto;
  @ApiPropertyOptional({ description: 'Ignorado: lo calcula el servidor con el recorrido GPS' }) @IsOptional() @IsInt() meteredFareCents?: number;
}

export class CancelTripDto extends TripActionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) reason?: string;
  @ApiPropertyOptional({ description: 'Chofer: el pasajero no se presentó (requiere la espera mínima)' })
  @IsOptional()
  @IsBoolean()
  noShow?: boolean;
}

export class ChangeDestinationDto {
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) destination!: PointDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) destinationAddress?: string;
  @ApiPropertyOptional({ description: 'Sin token: devuelve el precio nuevo. Con el token de esa respuesta: lo aplica.' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  quoteToken?: string;
}

export class RateTripDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
}

export class OfferResponseDto {
  @ApiProperty() @IsUUID() tripId!: string;
}
