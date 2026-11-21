import { Module } from '@nestjs/common';
import { LOCALITY_RESOLVER } from './locality-resolver';
import { PostgisLocalityResolver } from './postgis-locality-resolver';

@Module({
  providers: [{ provide: LOCALITY_RESOLVER, useClass: PostgisLocalityResolver }],
  exports: [LOCALITY_RESOLVER],
})
export class GeoModule {}
