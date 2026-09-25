import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { SyncPullQueryDto, SyncPushDto } from '../application/dto/sync.dto';
import { SynchronizationService } from '../application/synchronization.service';

@ApiTags('synchronization')
@ApiBearerAuth()
@Controller('sync')
export class SynchronizationController {
  constructor(private readonly sync: SynchronizationService) {}

  @Post('push')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply operations queued offline (idempotent, processed in order)',
  })
  push(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncPushDto) {
    return this.sync.push(
      user.id,
      dto.installationId,
      dto.operations.map((op) => ({
        ...op,
        createdAt: op.createdAt ? new Date(op.createdAt) : undefined,
      })),
    );
  }

  @Get('pull')
  @ApiOperation({
    summary: 'Saved and deleted routes since a cursor (multi-device restore)',
    description:
      'Pages of at most `limit` changes, oldest first. While `hasMore` is true, ask again ' +
      'with `since` and `afterId` taken from `next`.',
  })
  pull(@CurrentUser() user: AuthenticatedUser, @Query() query: SyncPullQueryDto) {
    return this.sync.pull(
      user.id,
      { since: query.since ? new Date(query.since) : undefined, afterId: query.afterId },
      query.limit,
    );
  }
}
