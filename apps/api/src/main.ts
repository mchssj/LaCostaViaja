import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, configureDocs, configureRealtime } from './bootstrap';
import { APP_CONFIG, loadDotEnvIfPresent, type AppConfig } from './config/app-config';

/**
 * Una promesa rechazada sin manejar (p. ej. un PUBLISH del adaptador de Socket.IO justo cuando Redis
 * se corta) no debe tumbar toda la API: Node 24 termina el proceso por defecto. Se registra y se sigue;
 * la cotización y lo que depende de PostgreSQL siguen funcionando y el despacho se recupera al volver Redis.
 */
function keepAliveOnUnhandledRejections(): void {
  const logger = new Logger('Proceso');
  process.on('unhandledRejection', (reason) => {
    logger.error(`Promesa rechazada sin manejar: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
}

async function bootstrap(): Promise<void> {
  keepAliveOnUnhandledRejections();
  loadDotEnvIfPresent();
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  await configureRealtime(app);
  configureDocs(app);
  const { port } = app.get<AppConfig>(APP_CONFIG);
  await app.listen(port);
  Logger.log(`API escuchando en http://localhost:${port}/api (documentación en /api/docs)`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err), 'Bootstrap');
  process.exit(1);
});
