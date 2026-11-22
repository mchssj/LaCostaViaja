import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SERVICE_TYPES, type ServiceType } from '@lacosta/domain';
import { Allow, CurrentPrincipal, OPERATORS, ReqMeta, RequirePermission, type Principal, type RequestMeta } from '../../security/principal';
import { PointDto } from '../trips/trips.dto';
import { TariffsAdminService, type RuleInput } from './tariffs-admin.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class CreateDraftDto {
  @ApiProperty({ example: 'CT-2027-INVIERNO' }) @Matches(/^[A-Z0-9-]{3,40}$/, { message: 'Código: 3 a 40 mayúsculas, números o guiones' }) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() copyFromId?: string;
  @ApiProperty({ example: '2027-03-01' }) @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) validTo?: string | null;
}

class UpdateDraftDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9-]{3,40}$/) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 300) legalInstrument?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) validFrom?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) validTo?: string | null;
  @ApiPropertyOptional({ example: '22:00' }) @IsOptional() @Matches(TIME) nightStartsAt?: string;
  @ApiPropertyOptional({ example: '06:00' }) @IsOptional() @Matches(TIME) nightEndsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(20000) interurbanMinOutsideM?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) roundingStepCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(3600) quoteTtlSeconds?: number;
}

class RuleDto implements RuleInput {
  @ApiProperty({ enum: SERVICE_TYPES }) @IsIn(SERVICE_TYPES) serviceType!: 'TAXI' | 'REMIS';
  @ApiProperty({ enum: ['URBAN', 'INTERURBAN'] }) @IsIn(['URBAN', 'INTERURBAN']) scope!: 'URBAN' | 'INTERURBAN';
  @ApiProperty({ enum: ['LOW', 'HIGH'] }) @IsIn(['LOW', 'HIGH']) season!: 'LOW' | 'HIGH';
  @ApiProperty({ enum: ['DAY', 'NIGHT'] }) @IsIn(['DAY', 'NIGHT']) timeBand!: 'DAY' | 'NIGHT';
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) flagFallCents!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) unitValueCents!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000) distanceUnitM!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(3_600) timeUnitS!: number;
  @ApiProperty() @IsNumber() @Min(1) @Max(120) referenceSpeedKmh!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) minimumFareCents!: number;
  @ApiProperty({ description: '0–100' }) @IsNumber() @Min(0) @Max(100) returnCoefficientPct!: number;
  @ApiProperty() @IsBoolean() backhaulWaivesReturn!: boolean;
}

class ReplaceRulesDto {
  @ApiProperty({ type: [RuleDto] }) @ArrayMinSize(16) @ArrayMaxSize(16) @ValidateNested({ each: true }) @Type(() => RuleDto) rules!: RuleDto[];
}

class ApproveDto {
  @ApiProperty({ example: 'Ordenanza 1234/2027' }) @IsString() @Length(5, 300) legalInstrument!: string;
  @ApiProperty() @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) validTo?: string | null;
  @ApiPropertyOptional({ description: 'Si se superpone con el vigente, terminarlo el día en que empieza este' }) @IsOptional() @IsBoolean() closeCurrent?: boolean;
}

class SimulateDto {
  @ApiProperty() @IsUUID() scheduleId!: string;
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) origin!: PointDto;
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) destination!: PointDto;
  @ApiProperty({ enum: SERVICE_TYPES }) @IsIn(SERVICE_TYPES) serviceType!: ServiceType;
  @ApiPropertyOptional({ description: 'Instante a cotizar (franja/temporada)' }) @IsOptional() @IsDateString() at?: string;
}

class SeasonDto {
  @ApiProperty({ example: 'Temporada de verano 2027' }) @IsString() @Length(3, 120) name!: string;
  @ApiProperty() @Matches(DATE) startsOn!: string;
  @ApiProperty({ description: 'Último día (inclusive)' }) @Matches(DATE) endsOn!: string;
}

@ApiTags('admin · tarifas')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ path: 'admin', version: ['1', VERSION_NEUTRAL] })
export class TariffsAdminController {
  constructor(private readonly tariffs: TariffsAdminService) {}

  @RequirePermission('tariffs.view')
  @Get('tariff-schedules')
  list() {
    return this.tariffs.list();
  }

  @RequirePermission('tariffs.view')
  @Get('tariff-schedules/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tariffs.get(id);
  }

  @RequirePermission('tariffs.edit')
  @Post('tariff-schedules')
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateDraftDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.createDraft(p, body, meta);
  }

  @RequirePermission('tariffs.edit')
  @Patch('tariff-schedules/:id')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDraftDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.updateDraft(p, id, body, meta);
  }

  @RequirePermission('tariffs.edit')
  @Put('tariff-schedules/:id/rules')
  rules(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReplaceRulesDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.replaceRules(p, id, body.rules, meta);
  }

  @RequirePermission('tariffs.edit')
  @Delete('tariff-schedules/:id')
  discard(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.discardDraft(p, id, meta);
  }

  @RequirePermission('tariffs.approve')
  @Post('tariff-schedules/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.approve(p, id, body, meta);
  }

  @RequirePermission('tariffs.approve')
  @Post('tariff-schedules/:id/retire')
  @HttpCode(HttpStatus.OK)
  retire(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.retire(p, id, meta);
  }

  @RequirePermission('tariffs.view')
  @Post('tariffs/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@Body() body: SimulateDto) {
    return this.tariffs.simulate({
      scheduleId: body.scheduleId,
      origin: body.origin,
      destination: body.destination,
      serviceType: body.serviceType,
      ...(body.at ? { at: body.at } : {}),
    });
  }

  @RequirePermission('tariffs.view')
  @Get('season-periods')
  seasons() {
    return this.tariffs.listSeasons();
  }

  @RequirePermission('tariffs.edit')
  @Post('season-periods')
  createSeason(@CurrentPrincipal() p: Principal, @Body() body: SeasonDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.upsertSeason(p, null, body, meta);
  }

  @RequirePermission('tariffs.edit')
  @Patch('season-periods/:id')
  updateSeason(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SeasonDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.upsertSeason(p, id, body, meta);
  }

  @RequirePermission('tariffs.edit')
  @Delete('season-periods/:id')
  deleteSeason(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.deleteSeason(p, id, meta);
  }
}
