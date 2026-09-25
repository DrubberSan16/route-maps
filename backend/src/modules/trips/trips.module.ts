import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TripsService } from './application/trips.service';
import { TripsController } from './presentation/trips.controller';

@Module({
  imports: [UsersModule],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
