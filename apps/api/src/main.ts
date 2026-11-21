import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, loadDotEnvIfPresent, type AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  loadDotEnvIfPresent();
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  const { port } = app.get<AppConfig>(APP_CONFIG);
  await app.listen(port);
  Logger.log(`API escuchando en http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err), 'Bootstrap');
  process.exit(1);
});
