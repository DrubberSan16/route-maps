import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiScopes } from '../../../common/decorators/api-scopes.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  toLocationPoint,
  TrafficQueryDto,
  TrackLocationBatchDto,
  TrackLocationDto,
} from '../application/dto/tracking.dto';
import { TrackingService } from '../application/tracking.service';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('location')
  @ApiScopes('trips:write')
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @ApiOperation({ summary: 'Record one GPS position of a trip (idempotent per timestamp)' })
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: TrackLocationDto) {
    return this.tracking.record(user.id, toLocationPoint(dto));
  }

  @Post('locations/batch')
  @ApiScopes('trips:write')
  @ApiOperation({ summary: 'Record up to 1000 buffered positions (offline upload)' })
  recordBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: TrackLocationBatchDto) {
    return this.tracking.recordBatch(user.id, dto.locations.map(toLocationPoint));
  }

  @Get('live')
  @ApiScopes('trips:read')
  @ApiOperation({
    summary: 'Active trips of the account with their last known position (fleet monitoring)',
  })
  live(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.live(user.id);
  }

  @Get('trips/:tripId/last')
  @ApiScopes('trips:read')
  @ApiOperation({ summary: 'Last known position of a trip' })
  last(@CurrentUser() user: AuthenticatedUser, @Param('tripId', ParseUUIDPipe) tripId: string) {
    return this.tracking.lastPosition(user.id, tripId);
  }

  @Get('traffic')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Anonymous live-traffic cells derived from recent platform trips' })
  traffic(@Query() query: TrafficQueryDto) {
    return this.tracking.traffic(query);
  }
}
