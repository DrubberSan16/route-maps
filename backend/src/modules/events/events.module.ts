import { Global, Module } from '@nestjs/common';
import { PlatformEventsService } from './application/platform-events.service';
import { EventsController } from './presentation/events.controller';

@Global()
@Module({
  controllers: [EventsController],
  providers: [PlatformEventsService],
  exports: [PlatformEventsService],
})
export class EventsModule {}
