import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiScopes } from '../../../common/decorators/api-scopes.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { EventsFeedQueryDto } from '../application/dto/events.dto';
import { PlatformEventsService } from '../application/platform-events.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: PlatformEventsService) {}

  @Get()
  @ApiScopes('events:read')
  @ApiOperation({
    summary:
      'Events of the account and of the platform after a position (pull alternative to webhooks)',
    description:
      'Oldest first. Keep `next` and ask again with `after=next`; while `hasMore` is true there ' +
      'are more events waiting. Events are kept for EVENTS_RETENTION_DAYS (30 by default).',
  })
  feed(@CurrentUser() user: AuthenticatedUser, @Query() query: EventsFeedQueryDto) {
    return this.events.feed(user.id, {
      after: BigInt(query.after),
      limit: query.limit,
      types: query.types,
    });
  }
}
