import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { HealthService } from '../application/health.service';

@ApiTags('health')
@Public()
@RawResponse()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Dependency health: database (critical), Redis, routing engine and geocoder',
  })
  @ApiOkResponse({ description: 'status ok or degraded (optional dependency down)' })
  @ApiServiceUnavailableResponse({ description: 'status error (database down)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.check();
    res.status(report.status === 'error' ? 503 : 200);
    return report;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process is running)' })
  live() {
    return { status: 'ok' };
  }
}
