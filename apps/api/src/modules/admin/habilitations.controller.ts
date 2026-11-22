import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { InvalidInputError } from '@lacosta/domain';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { Allow, CurrentPrincipal, OPERATORS, ReqMeta, RequirePermission, type Principal, type RequestMeta } from '../../security/principal';
import { HabilitationsService, type EntityType, type UploadedFile } from './habilitations.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTITY_TYPES = ['DRIVER', 'VEHICLE', 'AGENCY'] as const;
const DOC_TYPES = ['DNI', 'LICENCIA_PROFESIONAL', 'VTV', 'SEGURO_PASAJEROS', 'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES', 'CUIT', 'OTRO'] as const;
const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

class DriverDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() agencyId?: string | null;
  @ApiProperty({ example: 'SAN_BERNARDO' }) @Matches(/^[A-Z_]{3,40}$/) baseLocalityCode!: string;
  @ApiProperty() @Matches(/^[0-9.]{7,11}$/, { message: 'DNI inválido' }) dni!: string;
  @ApiProperty() @Matches(/^[0-9-]{11,13}$/, { message: 'CUIL inválido' }) cuil!: string;
  @ApiProperty() @IsString() @Length(2, 80) firstName!: string;
  @ApiProperty() @IsString() @Length(2, 80) lastName!: string;
  @ApiProperty({ example: '+5492257123456' }) @Matches(/^\+54(9)?[0-9]{10}$/, { message: 'Teléfono: +54 9 y 10 dígitos, sin espacios' }) phone!: string;
  @ApiProperty() @IsString() @Length(3, 40) professionalLicenseNumber!: string;
  @ApiProperty({ enum: ['D1', 'D2', 'D3', 'D4'] }) @IsIn(['D1', 'D2', 'D3', 'D4']) professionalLicenseClass!: 'D1' | 'D2' | 'D3' | 'D4';
  @ApiProperty() @Matches(DATE) professionalLicenseExpiresOn!: string;
  @ApiProperty() @IsString() @Length(3, 40) municipalDriverPermitNumber!: string;
  @ApiProperty() @Matches(DATE) municipalDriverPermitExpiresOn!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) criminalRecordExpiresOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptsInterurban?: boolean;
}

class UpdateDriverDto extends PartialType(DriverDto) {}

class VehicleDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() agencyId?: string | null;
  @ApiProperty({ enum: ['TAXI', 'REMIS'] }) @IsIn(['TAXI', 'REMIS']) serviceType!: 'TAXI' | 'REMIS';
  @ApiProperty({ example: 'AE123BC' }) @Matches(/^[A-Za-z]{2,3}[\s-]?[0-9]{3}[\s-]?[A-Za-z]{0,2}$/, { message: 'Patente inválida' }) plate!: string;
  @ApiProperty() @IsString() @Length(2, 40) make!: string;
  @ApiProperty() @IsString() @Length(1, 40) model!: string;
  @ApiProperty() @IsInt() @Min(1990) @Max(2100) modelYear!: number;
  @ApiProperty() @IsString() @Length(3, 30) color!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(8) passengerSeats!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wheelchairAccessible?: boolean;
  @ApiProperty() @IsString() @Length(3, 120) ownerName!: string;
  @ApiProperty() @Matches(/^[0-9-]{11,13}$/, { message: 'CUIT inválido' }) ownerCuit!: string;
  @ApiProperty() @IsString() @Length(3, 40) municipalVehiclePermitNumber!: string;
  @ApiProperty() @Matches(DATE) municipalVehiclePermitExpiresOn!: string;
  @ApiProperty() @Matches(DATE) vtvExpiresOn!: string;
  @ApiProperty() @IsString() @Length(2, 80) insurerName!: string;
  @ApiProperty() @IsString() @Length(3, 60) insurancePolicyNumber!: string;
  @ApiProperty() @Matches(DATE) passengerInsuranceExpiresOn!: string;
}

class UpdateVehicleDto extends PartialType(VehicleDto) {}

class AuthorizationDto {
  @ApiProperty() @IsUUID() driverId!: string;
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty({ enum: ['OWNER_DRIVER', 'PRIMARY_DRIVER', 'RELIEF_DRIVER'] }) @IsIn(['OWNER_DRIVER', 'PRIMARY_DRIVER', 'RELIEF_DRIVER']) role!: 'OWNER_DRIVER' | 'PRIMARY_DRIVER' | 'RELIEF_DRIVER';
  @ApiProperty() @IsString() @Length(3, 60) authorizationNumber!: string;
  @ApiProperty() @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) validTo?: string | null;
}

class StatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'] }) @IsIn(['ACTIVE', 'SUSPENDED', 'REVOKED']) status!: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 300) reason?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Solo suspensión de choferes: hasta cuándo' }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) until?: string | null;
}

class UploadDocumentDto {
  @ApiProperty({ enum: ENTITY_TYPES }) @IsIn(ENTITY_TYPES) entityType!: EntityType;
  @ApiProperty() @IsUUID() entityId!: string;
  @ApiProperty({ enum: DOC_TYPES }) @IsIn(DOC_TYPES) documentType!: (typeof DOC_TYPES)[number];
  @ApiPropertyOptional() @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) expiresOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) notes?: string;
}

class ReviewDto {
  @ApiProperty() @IsBoolean() verified!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 300) reason?: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) expiresOn?: string | null;
}

@ApiTags('admin · habilitaciones')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ path: 'admin', version: ['1', VERSION_NEUTRAL] })
export class HabilitationsController {
  constructor(private readonly hab: HabilitationsService) {}

  @RequirePermission('fleet.edit')
  @Post('drivers')
  createDriver(@CurrentPrincipal() p: Principal, @Body() body: DriverDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.createDriver(p, body, meta);
  }

  @RequirePermission('fleet.edit')
  @Patch('drivers/:id')
  updateDriver(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDriverDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.updateDriver(p, id, body, meta);
  }

  @RequirePermission('fleet.edit')
  @Post('vehicles')
  createVehicle(@CurrentPrincipal() p: Principal, @Body() body: VehicleDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.createVehicle(p, body, meta);
  }

  @RequirePermission('fleet.edit')
  @Patch('vehicles/:id')
  updateVehicle(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateVehicleDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.updateVehicle(p, id, body, meta);
  }

  @RequirePermission('fleet.edit')
  @Post('authorizations')
  createAuthorization(@CurrentPrincipal() p: Principal, @Body() body: AuthorizationDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.createAuthorization(p, body, meta);
  }

  @RequirePermission('fleet.status')
  @Post('authorizations/:id/status')
  @HttpCode(HttpStatus.OK)
  authorizationStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.setAuthorizationStatus(p, id, body.status, body.reason, meta);
  }

  // Express 5 no admite expresiones en las rutas: una ruta por tipo.
  @RequirePermission('fleet.status')
  @Post('drivers/:id/status')
  @HttpCode(HttpStatus.OK)
  driverStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.setStatus(p, 'DRIVER', id, body, meta);
  }

  @RequirePermission('fleet.status')
  @Post('vehicles/:id/status')
  @HttpCode(HttpStatus.OK)
  vehicleStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.setStatus(p, 'VEHICLE', id, body, meta);
  }

  @RequirePermission('fleet.status')
  @Post('agencies/:id/status')
  @HttpCode(HttpStatus.OK)
  agencyStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.setStatus(p, 'AGENCY', id, body, meta);
  }

  @RequirePermission('fleet.view')
  @Get('requirements/:type/:id')
  requirements(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    if (!ENTITY_TYPES.includes(type as EntityType)) throw new InvalidInputError('type inválido (DRIVER, VEHICLE, AGENCY)', {});
    return this.hab.requirements(type as EntityType, id);
  }

  @RequirePermission('drivers.pin_reset')
  @Post('drivers/:id/reset-pin')
  @HttpCode(HttpStatus.OK)
  resetPin(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.hab.resetDriverPin(p, id, meta);
  }

  @RequirePermission('fleet.view')
  @Get('expirations')
  expirations(@CurrentPrincipal() p: Principal, @Query('days') days?: string) {
    const n = Number(days ?? 30);
    return this.hab.expirations(p, Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 30);
  }

  // ------------------------------------------------------------------ documentos
  @RequirePermission('fleet.view')
  @Get('documents')
  documents(@CurrentPrincipal() p: Principal, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('status') status?: string) {
    if (entityType && !ENTITY_TYPES.includes(entityType as EntityType)) throw new InvalidInputError('entityType inválido', {});
    if (status && !['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) throw new InvalidInputError('status inválido', {});
    if (entityId && !/^[0-9a-f-]{36}$/i.test(entityId)) throw new InvalidInputError('entityId inválido', {});
    return this.hab.listDocuments(p, {
      ...(entityType ? { entityType: entityType as EntityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(status ? { status } : {}),
    });
  }

  @RequirePermission('documents.upload')
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@CurrentPrincipal() p: Principal, @Body() body: UploadDocumentDto, @UploadedFileParam() file: UploadedFile | undefined, @ReqMeta() meta: RequestMeta) {
    return this.hab.uploadDocument(p, body, file, meta);
  }

  @RequirePermission('fleet.view')
  @Get('documents/:id/file')
  async file(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.hab.readDocument(p, id);
    res.set({
      'Content-Type': f.mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(f.fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(f.data);
  }

  @RequirePermission('documents.review')
  @Post('documents/:id/review')
  @HttpCode(HttpStatus.OK)
  review(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto, @ReqMeta() meta: RequestMeta) {
    return this.hab.reviewDocument(p, id, body, meta);
  }
}
