import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  toLocationPoint,
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
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @ApiOperation({ summary: 'Record one GPS position of a trip (idempotent per timestamp)' })
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: TrackLocationDto) {
    return this.tracking.record(user.id, toLocationPoint(dto));
  }

  @Post('locations/batch')
  @ApiOperation({ summary: 'Record up to 1000 buffered positions (offline upload)' })
  recordBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: TrackLocationBatchDto) {
    return this.tracking.recordBatch(user.id, dto.locations.map(toLocationPoint));
  }

  @Get('trips/:tripId/last')
  @ApiOperation({ summary: 'Last known position of a trip' })
  last(@CurrentUser() user: AuthenticatedUser, @Param('tripId', ParseUUIDPipe) tripId: string) {
    return this.tracking.lastPosition(user.id, tripId);
  }
}
