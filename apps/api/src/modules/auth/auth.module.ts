import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { QrCodeService } from './qr-code.service';
import { LogSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  controllers: [AuthController],
  providers: [AuthService, QrCodeService, { provide: SMS_PROVIDER, useClass: LogSmsProvider }],
  exports: [AuthService, QrCodeService],
})
export class AuthModule {}
