import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { ALERT_NOTIFIER, LogAlertNotifier } from './alert-notifier';
import { PanicController } from './panic.controller';
import { PanicService } from './panic.service';
import { PanicWorkers } from './panic.workers';

@Module({
  imports: [RealtimeModule],
  controllers: [PanicController],
  providers: [PanicService, PanicWorkers, { provide: ALERT_NOTIFIER, useClass: LogAlertNotifier }],
  exports: [PanicService],
})
export class PanicModule {}
