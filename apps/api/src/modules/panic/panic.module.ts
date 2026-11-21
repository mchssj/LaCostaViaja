import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PanicController } from './panic.controller';
import { PanicGateway } from './panic.gateway';
import { PanicService } from './panic.service';

@Module({
  imports: [AuthModule],
  controllers: [PanicController],
  providers: [PanicService, PanicGateway],
  exports: [PanicService, PanicGateway],
})
export class PanicModule {}