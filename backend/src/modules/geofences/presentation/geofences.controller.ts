import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  CreateGeofenceDto,
  GeofenceCheckQueryDto,
  ListGeofencesQueryDto,
  toShape,
  UpdateGeofenceDto,
} from '../application/dto/geofence.dto';
import { GeofencesService } from '../application/geofences.service';

@ApiTags('geofences')
@ApiBearerAuth()
@Controller('geofences')
export class GeofencesController {
  constructor(private readonly geofences: GeofencesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a CIRCLE or POLYGON geofence' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGeofenceDto) {
    return this.geofences.create(user.id, {
      name: dto.name,
      description: dto.description,
      metadata: dto.metadata,
      active: dto.active,
      shape: toShape(dto)!,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List geofences' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGeofencesQueryDto) {
    return this.geofences.list(user.id, query.active ?? false);
  }

  @Get('check')
  @ApiOperation({ summary: 'Active geofences that contain a point (PostGIS ST_Intersects)' })
  check(@CurrentUser() user: AuthenticatedUser, @Query() query: GeofenceCheckQueryDto) {
    return this.geofences.check(user.id, { latitude: query.lat, longitude: query.lng });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Geofence detail' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.geofences.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a geofence; shape fields are merged with the stored shape',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGeofenceDto,
  ) {
    return this.geofences.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a geofence' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.geofences.delete(user.id, id);
  }
}
