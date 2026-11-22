import { Module } from '@nestjs/common';
import { FaresModule } from '../fares/fares.module';
import { PresenceModule } from '../presence/presence.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { AuditController } from './audit.controller';
import { FILE_STORAGE, LocalFileStorage } from './file-storage';
import { HabilitationsController } from './habilitations.controller';
import { HabilitationsService } from './habilitations.service';
import { TariffsAdminController } from './tariffs-admin.controller';
import { TariffsAdminService } from './tariffs-admin.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Panel administrativo (Fase 5): usuarios, tarifas, habilitaciones y auditoría. La configuración vive en SettingsModule. */
@Module({
  imports: [FaresModule, TariffsModule, PresenceModule],
  controllers: [UsersController, AuditController, TariffsAdminController, HabilitationsController],
  providers: [UsersService, TariffsAdminService, HabilitationsService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
})
export class AdminModule {}
