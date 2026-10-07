import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuditActor } from '../../audit/application/audit.service';
import { Actor } from '../../audit/presentation/actor.decorator';
import { TripPathQueryDto } from '../../trips/application/dto/trip.dto';
import { AdminOperationsService } from '../application/admin-operations.service';
import { ListAdminTripsQueryDto } from '../application/dto/admin.dto';
import { Staff } from './admin-roles';

const uuid = new ParseUUIDPipe();

@ApiTags('admin / trips')
@ApiBearerAuth()
@Staff()
@Controller('admin/trips')
export class AdminTripsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get()
  @ApiOperation({ summary: '[staff] Trips of every account, newest first' })
  list(@Query() query: ListAdminTripsQueryDto) {
    return this.operations.listTrips(query);
  }

  @Get('live')
  @ApiOperation({ summary: '[staff] Active trips of every account with their last position' })
  live() {
    return this.operations.live();
  }

  @Get(':id')
  @ApiOperation({ summary: '[staff] Trip with its account, device, route and current geofences' })
  get(@Param('id', uuid) id: string) {
    return this.operations.trip(id);
  }

  @Get(':id/path')
  @ApiOperation({ summary: '[staff] Recorded track (long tracks are sampled evenly)' })
  path(@Param('id', uuid) id: string, @Query() query: TripPathQueryDto) {
    return this.operations.tripPath(id, query.maxPoints);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @ApiOperation({ summary: '[staff] Complete an active trip (emits trip.finished)' })
  finish(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.operations.finishTrip(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '[staff] Cancel an active trip (emits trip.cancelled)' })
  cancel(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.operations.cancelTrip(actor, id);
  }
}
