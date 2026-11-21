import { Module } from '@nestjs/common';
import { PostgresTariffRepository } from './postgres-tariff.repository';
import { TARIFF_REPOSITORY } from './tariff-repository';

@Module({
  providers: [{ provide: TARIFF_REPOSITORY, useClass: PostgresTariffRepository }],
  exports: [TARIFF_REPOSITORY],
})
export class TariffsModule {}
