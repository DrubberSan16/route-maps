import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../../../common/types/authenticated-user';
import {
  CalculateRouteDto,
  CalculateRouteResponse,
  ListRoutesQueryDto,
  SaveRouteDto,
} from '../../application/dto/calculate-route.dto';
import { CalculateRouteUseCase } from '../../application/use-cases/calculate-route.use-case';
import { SavedRoutesService } from '../../application/use-cases/saved-routes.service';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly calculateRoute: CalculateRouteUseCase,
    private readonly savedRoutes: SavedRoutesService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Calculate a route (primary + optional alternatives) with the routing engine',
  })
  @ApiOkResponse({ type: CalculateRouteResponse })
  calculate(@Body() dto: CalculateRouteDto) {
    return this.calculateRoute.execute(dto);
  }

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Save a route (idempotent when the client supplies the id)' })
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveRouteDto) {
    return this.savedRoutes.save(user.id, {
      ...dto,
      steps: dto.steps ?? [],
      geometry: dto.geometry,
    });
  }

  @ApiBearerAuth()
  @Get()
  @ApiQuery({ name: 'includeGeometry', required: false, type: Boolean })
  @ApiOperation({ summary: 'List saved routes of the authenticated user' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRoutesQueryDto,
    @Query('includeGeometry', new ParseBoolPipe({ optional: true })) includeGeometry?: boolean,
  ) {
    return this.savedRoutes.list(user.id, {
      limit: query.limit,
      offset: query.offset,
      includeGeometry: includeGeometry ?? false,
    });
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Saved route with geometry and steps' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.savedRoutes.get(user.id, id);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved route' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.savedRoutes.delete(user.id, id);
  }
}
