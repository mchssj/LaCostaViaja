import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('operator/login')
  loginOperator(@Body() body: { username: string; password: string }) {
    return this.auth.loginOperator(body.username, body.password);
  }

  @Post('driver/login')
  loginDriver(@Body() body: { dni: string; pin: string }) {
    return this.auth.loginDriver(body.dni, body.pin);
  }

  @Post('passenger/otp')
  requestOtp(@Body() body: { phone: string }) {
    return this.auth.requestOtp(body.phone);
  }

  @Post('passenger/verify')
  verifyOtp(@Body() body: { phone: string; code: string }) {
    return this.auth.verifyOtp(body.phone, body.code);
  }

  @Post('guest')
  createGuest(@Body() body: { qrCode: string }) {
    return this.auth.createGuestSession(body.qrCode);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: { refreshToken: string }) {
    return this.auth.logout(body.refreshToken);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return { user: req.user };
  }
}