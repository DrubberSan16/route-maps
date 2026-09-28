import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { NATIVE_GRAPH_STORE } from '../../infrastructure/native/native-graph.store';
import { CalculateRouteUseCase } from './application/use-cases/calculate-route.use-case';
import { SavedRoutesService } from './application/use-cases/saved-routes.service';
import { ROUTE_REPOSITORY } from './domain/entities/saved-route';
import { ROUTING_PROVIDER } from './domain/interfaces/routing-provider';
import { createRoutingProvider } from './infrastructure/adapters/routing-provider.factory';
import { PrismaRouteRepository } from './infrastructure/repositories/prisma-route.repository';
import { RoutesController } from './presentation/controllers/routes.controller';
import { RouteConditionsService } from './application/route-conditions.service';
import { TrafficService } from './application/traffic.service';
import { TrafficController } from './presentation/controllers/traffic.controller';

@Module({
  controllers: [RoutesController, TrafficController],
  providers: [
    CalculateRouteUseCase,
    SavedRoutesService,
    RouteConditionsService,
    TrafficService,
    { provide: ROUTE_REPOSITORY, useClass: PrismaRouteRepository },
    {
      provide: ROUTING_PROVIDER,
      useFactory: createRoutingProvider,
      inject: [AppConfigService, NATIVE_GRAPH_STORE],
    },
  ],
  exports: [ROUTING_PROVIDER, SavedRoutesService],
})
export class RoutingModule {}
