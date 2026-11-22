import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from './common/domain-exception.filter';

/** Configuración HTTP compartida por main.ts y los tests (mismo comportamiento en ambos). */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  return app;
}
