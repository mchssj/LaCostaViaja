import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '../../../common/jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Token requerido');
    const token = header.slice(7);
    try {
      req.user = await this.jwt.verifyAccess(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}