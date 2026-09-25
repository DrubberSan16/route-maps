import { Injectable } from '@nestjs/common';
import { DownloadedRegionStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MapRegionService } from './map-region.service';

/** Tracks which region versions each device keeps offline (reported through sync). */
@Injectable()
export class DownloadedRegionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regions: MapRegionService,
  ) {}

  async record(input: {
    userId: string;
    deviceId: string;
    regionCode: string;
    version: string;
    status: DownloadedRegionStatus;
  }) {
    const region = await this.regions.get(input.regionCode);
    return this.prisma.downloadedRegion.upsert({
      where: { deviceId_regionId: { deviceId: input.deviceId, regionId: region.id } },
      create: {
        userId: input.userId,
        deviceId: input.deviceId,
        regionId: region.id,
        version: input.version,
        status: input.status,
      },
      update: { version: input.version, status: input.status },
    });
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.downloadedRegion.findMany({
      where: { userId, status: DownloadedRegionStatus.DOWNLOADED },
      include: {
        region: { select: { code: true, name: true, version: true } },
        device: { select: { installationId: true, platform: true, model: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => ({
      regionId: row.region.code,
      regionName: row.region.name,
      localVersion: row.version,
      latestVersion: row.region.version,
      updateAvailable: row.version !== row.region.version,
      device: row.device,
      downloadedAt: row.downloadedAt,
      updatedAt: row.updatedAt,
    }));
  }
}
