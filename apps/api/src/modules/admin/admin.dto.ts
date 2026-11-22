import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OPERATOR_ROLES, type OperatorRole } from '@lacosta/domain';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

export class CreateUserDto {
  @ApiProperty({ example: 'jperez' })
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: 'Usuario: 3 a 40 letras, números, punto, guion o guion bajo' })
  username!: string;
  @ApiProperty({ example: 'Juana Pérez' }) @IsString() @Length(3, 120) fullName!: string;
  @ApiPropertyOptional() @Transform(emptyToUndefined) @IsOptional() @IsEmail({}, { message: 'Correo inválido' }) email?: string;
  @ApiProperty({ enum: OPERATOR_ROLES }) @IsIn(OPERATOR_ROLES) role!: OperatorRole;
  @ApiPropertyOptional({ description: 'Obligatorio para AGENCY_OPERATOR' }) @Transform(emptyToUndefined) @IsOptional() @IsUUID() agencyId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 120) fullName?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail({}, { message: 'Correo inválido' }) email?: string | null;
  @ApiPropertyOptional({ enum: OPERATOR_ROLES }) @IsOptional() @IsIn(OPERATOR_ROLES) role?: OperatorRole;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() agencyId?: string | null;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 300) reason?: string;
}
