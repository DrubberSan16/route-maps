import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { buildLoggerParams } from './infrastructure/logging/logger.config';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { IntegrationsWorkerModule } from './modules/integrations/integrations-worker.module';

/** Background process: webhook deliveries and clean-up of old events (no HTTP server). */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfigService], useFactory: buildLoggerParams }),
    PrismaModule,
    IntegrationsWorkerModule,
  ],
})
export class WorkerModule {}
