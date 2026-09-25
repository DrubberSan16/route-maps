import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  CreatePlaceDto,
  FavoriteDto,
  SearchPlacesQueryDto,
  UpdatePlaceDto,
} from '../application/dto/place.dto';
import { PlacesService } from '../application/places.service';

@ApiTags('places')
@ApiBearerAuth()
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a place (point of interest) for the user' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlaceDto) {
    return this.places.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Search own and shared places by text and/or proximity' })
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchPlacesQueryDto) {
    return this.places.search(user.id, {
      text: query.q,
      near:
        query.lat !== undefined && query.lng !== undefined
          ? { latitude: query.lat, longitude: query.lng, radiusMeters: query.radius }
          : undefined,
      favoritesOnly: query.favorites,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Place detail' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.places.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an own place' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaceDto,
  ) {
    return this.places.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an own place' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.places.delete(user.id, id);
  }

  @Put(':id/favorite')
  @ApiOperation({ summary: 'Mark a place as favorite (with optional alias)' })
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FavoriteDto,
  ) {
    return this.places.favorite(user.id, id, dto.alias ?? null);
  }

  @Delete(':id/favorite')
  @ApiOperation({ summary: 'Remove a place from favorites' })
  unfavorite(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.places.unfavorite(user.id, id);
  }
}
