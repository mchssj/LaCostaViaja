import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class OperatorLoginDto {
  @ApiProperty() @IsString() @Length(3, 64) username!: string;
  @ApiProperty() @IsString() @Length(4, 128) password!: string;
}

export class DriverLoginDto {
  @ApiProperty({ example: '28456789' }) @Matches(/^[0-9]{7,9}$/) dni!: string;
  @ApiProperty({ example: '123456' }) @Matches(/^[0-9]{6}$/, { message: 'El PIN tiene 6 dígitos' }) pin!: string;
}

export class OtpRequestDto {
  @ApiProperty({ example: '+5492257555111' }) @Matches(/^\+[0-9]{8,15}$/) phone!: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+5492257555111' }) @Matches(/^\+[0-9]{8,15}$/) phone!: string;
  @ApiProperty({ example: '482913' }) @Matches(/^[0-9]{6}$/) code!: string;
}

export class GuestSessionDto {
  @ApiProperty({ description: 'Contenido del QR de la parada / hotel (LCQR1.…)' }) @IsString() @Length(1, 2048) qrCode!: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken!: string;
}

export class IssueQrDto {
  @ApiProperty({ example: 'Parada Av. Chiozza y Costanera' }) @IsString() @Length(3, 120) label!: string;
  @ApiPropertyOptional({ example: 'SB_PARADA_COSTANERA' }) @IsOptional() @IsString() @MaxLength(40) zoneCode?: string;
}
