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
import type { AuditActor } from '../../audit/application/audit.service';
import { Actor } from '../../audit/presentation/actor.decorator';
import { UpdateGeofenceDto } from '../../geofences/application/dto/geofence.dto';
import { CreatePlaceDto, UpdatePlaceDto } from '../../places/application/dto/place.dto';
import { AdminGeodataService } from '../application/admin-geodata.service';
import {
  CreateAdminGeofenceDto,
  ListAdminGeofencesQueryDto,
  ListAdminPlacesQueryDto,
  ListAdminRoutesQueryDto,
} from '../application/dto/admin.dto';
import { AdminOnly, Staff } from './admin-roles';

const uuid = new ParseUUIDPipe();

@ApiTags('admin / geofences')
@ApiBearerAuth()
@Staff()
@Controller('admin/geofences')
export class AdminGeofencesController {
  constructor(private readonly geodata: AdminGeodataService) {}

  @Get()
  @ApiOperation({ summary: '[staff] Geofences of every account with their shape' })
  list(@Query() query: ListAdminGeofencesQueryDto) {
    return this.geodata.listGeofences(query);
  }

  @Post()
  @ApiOperation({ summary: '[staff] Create a geofence for an account' })
  create(@Actor() actor: AuditActor, @Body() dto: CreateAdminGeofenceDto) {
    return this.geodata.createGeofence(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '[staff] Geofence with its account' })
  get(@Param('id', uuid) id: string) {
    return this.geodata.geofence(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[staff] Change, enable or disable a geofence of any account' })
  update(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateGeofenceDto,
  ) {
    return this.geodata.updateGeofence(actor, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '[staff] Delete a geofence of any account' })
  delete(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.geodata.deleteGeofence(actor, id);
  }
}

@ApiTags('admin / places')
@ApiBearerAuth()
@Staff()
@Controller('admin/places')
export class AdminPlacesController {
  constructor(private readonly geodata: AdminGeodataService) {}

  @Get()
  @ApiOperation({ summary: '[staff] Shared places and the places of every account' })
  list(@Query() query: ListAdminPlacesQueryDto) {
    return this.geodata.listPlaces(query);
  }

  @Post()
  @ApiOperation({ summary: '[staff] Create a shared place, visible to every account' })
  create(@Actor() actor: AuditActor, @Body() dto: CreatePlaceDto) {
    return this.geodata.createPlace(actor, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[staff] Change a shared place' })
  update(@Actor() actor: AuditActor, @Param('id', uuid) id: string, @Body() dto: UpdatePlaceDto) {
    return this.geodata.updatePlace(actor, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '[staff] Delete a shared place' })
  delete(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.geodata.deletePlace(actor, id);
  }
}

@ApiTags('admin / routes')
@ApiBearerAuth()
@Staff()
@Controller('admin/routes')
export class AdminRoutesController {
  constructor(private readonly geodata: AdminGeodataService) {}

  @Get()
  @ApiOperation({ summary: '[staff] Saved routes of every account (without geometry)' })
  list(@Query() query: ListAdminRoutesQueryDto) {
    return this.geodata.listRoutes(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '[staff] Saved route with its geometry and instructions' })
  get(@Param('id', uuid) id: string) {
    return this.geodata.route(id);
  }

  @AdminOnly()
  @Delete(':id')
  @ApiOperation({ summary: '[admin] Delete a saved route (its devices drop it at next sync)' })
  delete(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.geodata.deleteRoute(actor, id);
  }
}
