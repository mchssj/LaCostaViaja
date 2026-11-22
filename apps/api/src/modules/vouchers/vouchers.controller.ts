import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Allow, OPERATORS, RequirePermission } from '../../security/principal';
import { VouchersService } from './vouchers.service';

class CreateProgramDto {
  @ApiProperty() @IsString() @Length(3, 120) name!: string;
  @ApiProperty({ enum: ['HEALTH', 'DISABILITY', 'EMPLOYEE', 'OTHER'] }) @IsIn(['HEALTH', 'DISABILITY', 'EMPLOYEE', 'OTHER']) programType!: string;
  @ApiProperty({ example: '2026-11-01' }) @IsDateString() periodStart!: string;
  @ApiProperty({ example: '2027-10-31' }) @IsDateString() periodEnd!: string;
  @ApiProperty({ description: 'Presupuesto del período en centavos' }) @IsInt() @Min(0) @Max(2_000_000_000) budgetCents!: number;
}

class CreateVoucherDto {
  @ApiPropertyOptional({ description: 'Si no se envía (o viene vacío), se genera (LCV-XXXX-XXXX)' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @Matches(/^[A-Z0-9-]{6,32}$/)
  code?: string;
  @ApiProperty() @IsUUID() programId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) initialBalanceCents!: number;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiProperty() @IsDateString() validUntil!: string;
  @ApiPropertyOptional({ description: 'Se guarda solo un HMAC del DNI' }) @IsOptional() @Matches(/^[0-9]{7,9}$/) beneficiaryDni?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() beneficiaryPassengerId?: string;
}

/**
 * Administración de programas y vouchers: solo la administración municipal.
 * El saldo NO se mueve por endpoints: lo maneja el ciclo del viaje (reserva / consumo / liberación).
 */
@ApiTags('vouchers')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @RequirePermission('vouchers.manage')
  @Post('municipal-programs')
  createProgram(@Body() body: CreateProgramDto) {
    return this.vouchers.createProgram(body);
  }

  @RequirePermission('vouchers.view')
  @Get('municipal-programs')
  listPrograms() {
    return this.vouchers.listPrograms();
  }

  @RequirePermission('vouchers.manage')
  @Post('vouchers')
  createVoucher(@Body() body: CreateVoucherDto) {
    return this.vouchers.createVoucher(body);
  }

  @RequirePermission('vouchers.view')
  @Get('vouchers')
  listVouchers(@Query('programId') programId?: string) {
    return this.vouchers.listVouchers(programId);
  }

  @RequirePermission('vouchers.view')
  @Get('vouchers/:id')
  getVoucher(@Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.getVoucher(id);
  }
}
