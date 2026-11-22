import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { QrCodeService } from './qr-code.service';
import { LogSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccountService, MfaService, QrCodeService, { provide: SMS_PROVIDER, useClass: LogSmsProvider }],
  exports: [AuthService, MfaService, QrCodeService],
})
export class AuthModule {}
