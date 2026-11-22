import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuthGuard } from './auth.guard';
import { OperatorStateService } from './operator-state.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { JwtService } from './jwt.service';
import { QuoteTokenService } from './quote-token.service';
import { RateLimiter, RateLimitGuard } from './rate-limit';

/**
 * Seguridad transversal. Los guards globales corren en este orden: primero la sesión (AuthGuard),
 * después el límite de pedidos (que ya conoce al usuario).
 */
@Global()
@Module({
  providers: [
    JwtService,
    QuoteTokenService,
    RateLimiter,
    OperatorStateService,
    AuditService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [JwtService, QuoteTokenService, RateLimiter, OperatorStateService, AuditService],
})
export class SecurityModule {}
