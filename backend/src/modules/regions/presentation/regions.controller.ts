import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AppConfigService } from '../../../config/app-config.service';
import { UserRole } from '../../../generated/prisma/enums';
import {
  CheckUpdatesDto,
  ListRegionsQueryDto,
  LocateQueryDto,
  MapRegionResponse,
  RegionVersionQueryDto,
  SetRegionEnabledDto,
  SyncRegionsDto,
  toRegionResponse,
  VersionStatusResponse,
} from '../application/dto/region.dto';
import { DownloadedRegionsService } from '../application/downloaded-regions.service';
import { MapRegionService } from '../application/map-region.service';
import { RegionDownloadService } from '../application/region-download.service';

@ApiTags('maps / regions')
@Controller('maps/regions')
export class RegionsController {
  constructor(
    private readonly regions: MapRegionService,
    private readonly downloads: RegionDownloadService,
    private readonly downloaded: DownloadedRegionsService,
    private readonly config: AppConfigService,
  ) {}

  private get tilesBase(): string {
    return this.config.get('maps').publicTilesBaseUrl;
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List offline map regions available for download' })
  @ApiOkResponse({ type: MapRegionResponse, isArray: true })
  async list(@Query() query: ListRegionsQueryDto, @CurrentUser() user?: AuthenticatedUser) {
    const includeDisabled = Boolean(query.includeDisabled) && user?.role === UserRole.ADMIN;
    const regions = await this.regions.list(includeDisabled);
    return regions.map((region) => toRegionResponse(region, this.tilesBase));
  }

  @Public()
  @Get('locate')
  @ApiOperation({ summary: 'Regions whose bounding box contains a GPS position (smallest first)' })
  @ApiOkResponse({ type: MapRegionResponse, isArray: true })
  async locate(@Query() query: LocateQueryDto) {
    const regions = await this.regions.locate(query.lat, query.lng);
    return regions.map((region) => toRegionResponse(region, this.tilesBase));
  }

  @ApiBearerAuth()
  @Get('downloaded')
  @ApiOperation({ summary: 'Regions stored offline on the devices of the authenticated user' })
  listDownloaded(@CurrentUser() user: AuthenticatedUser) {
    return this.downloaded.listForUser(user.id);
  }

  @Public()
  @Post('updates')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check which locally stored regions have a newer version' })
  @ApiOkResponse({ type: VersionStatusResponse, isArray: true })
  checkUpdates(@Body() dto: CheckUpdatesDto) {
    return this.regions.checkUpdates(dto.regions);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN)
  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: '[admin] Register regions from the manifests found in map storage' })
  sync(@Body() dto: SyncRegionsDto) {
    return this.regions.syncFromStorage({ force: dto.force });
  }

  @Public()
  @Get(':id')
  @ApiParam({ name: 'id', example: 'guayaquil' })
  @ApiOperation({ summary: 'Region detail' })
  @ApiOkResponse({ type: MapRegionResponse })
  async get(@Param('id') id: string) {
    return toRegionResponse(await this.regions.getEnabled(id), this.tilesBase);
  }

  @Public()
  @Get(':id/version')
  @ApiParam({ name: 'id', example: 'guayaquil' })
  @ApiOperation({ summary: 'Latest version/checksum and whether the local copy is outdated' })
  @ApiOkResponse({ type: VersionStatusResponse })
  version(@Param('id') id: string, @Query() query: RegionVersionQueryDto) {
    return this.regions.version(id, query.localVersion);
  }

  @Public()
  @RawResponse()
  @Get(':id/download')
  @ApiParam({ name: 'id', example: 'guayaquil' })
  @ApiProduces('application/vnd.pmtiles')
  @ApiOperation({
    summary: 'Download the region PMTiles file (supports Range / resumable downloads)',
  })
  async download(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.downloads.send(await this.regions.getEnabled(id), 'map', req, res);
  }

  @Public()
  @RawResponse()
  @Get(':id/routing/download')
  @ApiParam({ name: 'id', example: 'guayaquil' })
  @ApiProduces('application/x-tar')
  @ApiOperation({
    summary: 'Download the routing package (Valhalla tiles) for future on-device routing',
  })
  async downloadRouting(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.downloads.send(await this.regions.getEnabled(id), 'routing', req, res);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: '[admin] Enable or disable a region' })
  @ApiOkResponse({ type: MapRegionResponse })
  async setEnabled(@Param('id') id: string, @Body() dto: SetRegionEnabledDto) {
    return toRegionResponse(await this.regions.setEnabled(id, dto.enabled), this.tilesBase);
  }
}
