import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { CalculateRouteUseCase } from './application/use-cases/calculate-route.use-case';
import { SavedRoutesService } from './application/use-cases/saved-routes.service';
import { ROUTE_REPOSITORY } from './domain/entities/saved-route';
import { ROUTING_PROVIDER } from './domain/interfaces/routing-provider';
import { createRoutingProvider } from './infrastructure/adapters/routing-provider.factory';
import { PrismaRouteRepository } from './infrastructure/repositories/prisma-route.repository';
import { RoutesController } from './presentation/controllers/routes.controller';
import { RouteConditionsService } from './application/route-conditions.service';

@Module({
  controllers: [RoutesController],
  providers: [
    CalculateRouteUseCase,
    SavedRoutesService,
    RouteConditionsService,
    { provide: ROUTE_REPOSITORY, useClass: PrismaRouteRepository },
    { provide: ROUTING_PROVIDER, useFactory: createRoutingProvider, inject: [AppConfigService] },
  ],
  exports: [ROUTING_PROVIDER, SavedRoutesService],
})
export class RoutingModule {}
