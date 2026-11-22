import { Body, Controller, Get, Global, Module, Param, Patch, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';
import { Allow, CurrentPrincipal, OPERATORS, ReqMeta, RequirePermission, type Principal, type RequestMeta } from '../../security/principal';
import { SettingsService } from './settings.service';

class UpdateSettingDto {
  @ApiProperty({ description: 'Número o booleano según el tipo del parámetro' }) @IsDefined() value!: number | boolean;
}

@ApiTags('admin · configuración')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ path: 'admin/settings', version: ['1', VERSION_NEUTRAL] })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings.view')
  @Get()
  list() {
    return this.settings.list();
  }

  @RequirePermission('settings.edit')
  @Patch(':key')
  update(@CurrentPrincipal() p: Principal, @Param('key') key: string, @Body() body: UpdateSettingDto, @ReqMeta() meta: RequestMeta) {
    return this.settings.update(p, key, body.value, meta);
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
