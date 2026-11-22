import { Body, Controller, Get, HttpCode, HttpStatus, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Allow, AllowDuringSetup, CurrentPrincipal, OPERATORS, Public, ReqMeta, RequirePermission, type Principal, type RequestMeta } from '../../security/principal';
import { RateLimit } from '../../security/rate-limit';
import { AccountService } from './account.service';
import { MfaService } from './mfa.service';
import {
  ChangePasswordDto,
  MfaCodeDto,
  OperatorMfaDto,
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
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @RateLimit({ name: 'login-operator', limit: 10, windowSeconds: 60, by: 'ip' })
  @Post('operator/login')
  @HttpCode(HttpStatus.OK)
  loginOperator(@Body() body: OperatorLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.loginOperator(body.username, body.password, meta);
  }

  /** Segundo paso del login cuando la cuenta tiene 2FA. */
  @Public()
  @RateLimit({ name: 'login-operator-mfa', limit: 10, windowSeconds: 60, by: 'ip' })
  @Post('operator/mfa')
  @HttpCode(HttpStatus.OK)
  loginOperatorMfa(@Body() body: OperatorMfaDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.loginOperatorMfa(body.mfaToken, body.code, meta);
  }

  // ------------------------------------------------------------ mi cuenta (operador)
  @ApiBearerAuth()
  @Allow(...OPERATORS)
  @AllowDuringSetup()
  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentPrincipal() p: Principal, @Body() body: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.account.changePassword(p, body.currentPassword, body.newPassword, meta);
  }

  @ApiBearerAuth()
  @Allow(...OPERATORS)
  @AllowDuringSetup()
  @Post('me/mfa/setup')
  @HttpCode(HttpStatus.OK)
  mfaSetup(@CurrentPrincipal() p: Principal) {
    return this.mfa.setup(p);
  }

  @ApiBearerAuth()
  @Allow(...OPERATORS)
  @AllowDuringSetup()
  @Post('me/mfa/enable')
  @HttpCode(HttpStatus.OK)
  async mfaEnable(@CurrentPrincipal() p: Principal, @Body() body: MfaCodeDto, @ReqMeta() meta: RequestMeta) {
    const { recoveryCodes } = await this.mfa.enable(p, body.code, meta);
    return { recoveryCodes, user: await this.auth.operatorProfile(p.id) };
  }

  @ApiBearerAuth()
  @Allow(...OPERATORS)
  @Post('me/mfa/disable')
  @HttpCode(HttpStatus.OK)
  mfaDisable(@CurrentPrincipal() p: Principal, @Body() body: MfaCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.mfa.disable(p, body.code, meta);
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

  /** Operadores: perfil con permisos y configuración pendiente. Resto: el principal. */
  @ApiBearerAuth()
  @AllowDuringSetup()
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    return { user: principal.kind === 'OPERATOR' ? await this.auth.operatorProfile(principal.id) : principal };
  }

  /** Genera el contenido de un QR firmado para imprimir (paradas, hoteles, accesos de playa). */
  @ApiBearerAuth()
  @Allow(...OPERATORS)
  @RequirePermission('qr.issue')
  @Post('guest-qr-codes')
  issueQr(@Body() body: IssueQrDto) {
    return this.auth.issueQr(body.label, body.zoneCode ?? null);
  }
}
