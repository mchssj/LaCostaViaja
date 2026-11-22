import { Body, Controller, Get, HttpCode, HttpStatus, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Allow, CurrentPrincipal, Public, type Principal } from '../../security/principal';
import { RateLimit } from '../../security/rate-limit';
import {
  DriverLoginDto,
  GuestSessionDto,
  IssueQrDto,
  OperatorLoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: ['1', VERSION_NEUTRAL] })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ name: 'login-operator', limit: 10, windowSeconds: 60, by: 'ip' })
  @Post('operator/login')
  @HttpCode(HttpStatus.OK)
  loginOperator(@Body() body: OperatorLoginDto) {
    return this.auth.loginOperator(body.username, body.password);
  }

  @Public()
  @RateLimit({ name: 'login-driver', limit: 10, windowSeconds: 60, by: 'ip' })
  @Post('driver/login')
  @HttpCode(HttpStatus.OK)
  loginDriver(@Body() body: DriverLoginDto) {
    return this.auth.loginDriver(body.dni, body.pin);
  }

  @Public()
  @RateLimit({ name: 'otp-request', limit: 5, windowSeconds: 600, by: 'ip' })
  @Post('passenger/otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() body: OtpRequestDto) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @RateLimit({ name: 'otp-verify', limit: 10, windowSeconds: 600, by: 'ip' })
  @Post('passenger/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() body: OtpVerifyDto) {
    return this.auth.verifyOtp(body.phone, body.code);
  }

  @Public()
  @RateLimit({ name: 'guest-session', limit: 20, windowSeconds: 600, by: 'ip' })
  @Post('guest')
  @HttpCode(HttpStatus.OK)
  createGuest(@Body() body: GuestSessionDto) {
    return this.auth.createGuestSession(body.qrCode);
  }

  @Public()
  @RateLimit({ name: 'refresh', limit: 30, windowSeconds: 60, by: 'ip' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() body: RefreshDto) {
    return this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentPrincipal() principal: Principal) {
    return { user: principal };
  }

  /** Genera el contenido de un QR firmado para imprimir (paradas, hoteles, accesos de playa). */
  @ApiBearerAuth()
  @Allow('MUNICIPAL_ADMIN')
  @Post('guest-qr-codes')
  issueQr(@Body() body: IssueQrDto) {
    return this.auth.issueQr(body.label, body.zoneCode ?? null);
  }
}
