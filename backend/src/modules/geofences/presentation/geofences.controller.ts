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
import { ApiScopes } from '../../../common/decorators/api-scopes.decorator';
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
  @ApiScopes('geofences:write')
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
  @ApiScopes('geofences:read')
  @ApiOperation({ summary: 'List geofences' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGeofencesQueryDto) {
    return this.geofences.list(user.id, query.active ?? false);
  }

  @Get('check')
  @ApiScopes('geofences:read')
  @ApiOperation({ summary: 'Active geofences that contain a point (PostGIS ST_Intersects)' })
  check(@CurrentUser() user: AuthenticatedUser, @Query() query: GeofenceCheckQueryDto) {
    return this.geofences.check(user.id, { latitude: query.lat, longitude: query.lng });
  }

  @Get(':id')
  @ApiScopes('geofences:read')
  @ApiOperation({ summary: 'Geofence detail' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.geofences.get(user.id, id);
  }

  @Patch(':id')
  @ApiScopes('geofences:write')
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
  @ApiScopes('geofences:write')
  @ApiOperation({ summary: 'Delete a geofence' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.geofences.delete(user.id, id);
  }
}
