import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AuditService } from '../../audit/application/audit.service';
import { PlatformEventsService } from '../../events/application/platform-events.service';
import { AdminOperationsService } from '../application/admin-operations.service';
import { AdminOverviewService } from '../application/admin-overview.service';
import {
  ListAdminEventsQueryDto,
  ListAuditQueryDto,
  ListDevicesQueryDto,
  ListSyncEventsQueryDto,
} from '../application/dto/admin.dto';
import { AdminOnly, Staff } from './admin-roles';

const uuid = new ParseUUIDPipe();

@ApiTags('admin')
@ApiBearerAuth()
@Staff()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly overviewService: AdminOverviewService,
    private readonly operations: AdminOperationsService,
    private readonly events: PlatformEventsService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '[staff] Platform figures and the activity of the last 14 days' })
  overview() {
    return this.overviewService.overview();
  }

  @Get('meta')
  @ApiOperation({ summary: '[staff] Signed-in member and the catalogues of the panel' })
  meta(@CurrentUser() user: AuthenticatedUser) {
    return this.overviewService.meta(user);
  }

  @Get('devices')
  @ApiOperation({ summary: '[staff] Devices of every account, most recently seen first' })
  devices(@Query() query: ListDevicesQueryDto) {
    return this.operations.devices(query);
  }

  @Get('sync-events')
  @ApiOperation({ summary: '[staff] Operations uploaded from the offline queues of the apps' })
  syncEvents(@Query() query: ListSyncEventsQueryDto) {
    return this.operations.syncEvents(query);
  }

  @Get('sync-events/:id')
  @ApiOperation({ summary: '[staff] One uploaded operation with its payload' })
  syncEvent(@Param('id', uuid) id: string) {
    return this.operations.syncEvent(id);
  }

  @Get('regions')
  @ApiOperation({
    summary: '[staff] Every map region (disabled ones too) and the devices that keep it',
  })
  regions() {
    return this.operations.regionsWithDownloads();
  }

  @Get('events')
  @ApiOperation({ summary: '[staff] Platform events, newest first, with their deliveries' })
  eventList(@Query() query: ListAdminEventsQueryDto) {
    return this.events.list(query);
  }

  @Get('events/:id')
  @ApiOperation({ summary: '[staff] One event and each webhook delivery it produced' })
  event(@Param('id', uuid) id: string) {
    return this.events.detail(id);
  }

  @AdminOnly()
  @Get('audit')
  @ApiOperation({ summary: '[admin] What administrators and operators changed, newest first' })
  auditLog(@Query() query: ListAuditQueryDto) {
    return this.audit.list({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
