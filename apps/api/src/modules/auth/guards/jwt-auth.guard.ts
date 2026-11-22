/**
 * @deprecated La sesión la exige el AuthGuard GLOBAL (src/security/auth.guard.ts) en todos los endpoints.
 * Usar @Public() para abrir un endpoint y @Allow(...) para restringirlo por rol.
 * Se mantiene este alias solo para no romper imports existentes.
 */
export { AuthGuard as JwtAuthGuard } from '../../../security/auth.guard';
