import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(config: AppConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.get('database').url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Last step of the shutdown: services that still write (usage counters, webhook deliveries)
   * finish in `beforeApplicationShutdown`, which runs before this.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight connectivity probe used by the health module. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
