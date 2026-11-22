import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { RedisIoAdapter } from './common/redis-io.adapter';

/** Configuración HTTP compartida por main.ts y los tests (mismo comportamiento en ambos). */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  return app;
}

/** WebSockets con adaptador de Redis (eventos entre réplicas). Se llama antes de app.init()/listen(). */
export async function configureRealtime(app: INestApplication): Promise<void> {
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
}

/** Documentación OpenAPI en /api/docs. */
export function configureDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('La Costa Viaja — API')
    .setDescription('Despacho y movilidad municipal · Partido de La Costa. Todo endpoint exige JWT salvo los marcados como públicos.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
