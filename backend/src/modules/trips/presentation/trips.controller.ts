import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  FinishTripDto,
  ListTripsQueryDto,
  StartTripDto,
  TripPathQueryDto,
} from '../application/dto/trip.dto';
import { TripsService } from '../application/trips.service';

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @ApiOperation({ summary: 'Start a trip (recorded track)' })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartTripDto) {
    return this.trips.start(user.id, {
      ...dto,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List trips' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTripsQueryDto) {
    return this.trips.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Trip detail' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(user.id, id);
  }

  @Get(':id/path')
  @ApiOperation({
    summary: 'Recorded track as a GeoJSON LineString through the returned points',
    description:
      'Tracks longer than maxPoints are sampled evenly; distanceMeters and totalPoints ' +
      'always cover every recorded point.',
  })
  path(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TripPathQueryDto,
  ) {
    return this.trips.path(user.id, id, query.maxPoints);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish a trip and compute its travelled distance' })
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishTripDto,
  ) {
    return this.trips.finish(user.id, id, dto.endedAt ? new Date(dto.endedAt) : undefined);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an active trip' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.cancel(user.id, id);
  }
}
