import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig, type AppConfig } from './app-config';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
