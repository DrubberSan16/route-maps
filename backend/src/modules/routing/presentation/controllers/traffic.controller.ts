import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../../common/decorators/public.decorator';
import { AppException } from '../../../../common/errors/app.exception';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { BoundingBoxQuery, TrafficService } from '../../application/traffic.service';

const parseBbox = (value: string | undefined): BoundingBoxQuery => {
  const parts = (value ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new AppException(
      ErrorCode.INVALID_COORDINATES,
      'bbox must be minLng,minLat,maxLng,maxLat',
    );
  }
  return parts as BoundingBoxQuery;
};

@ApiTags('traffic')
@Public()
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Get('flow')
  @ApiOperation({
    summary:
      'Traffic by road segment (GeoJSON) from anonymous trip fixes: live (last 15 minutes) and, ' +
      'where there is no live data, typical for this day type and hour (last 4 weeks)',
  })
  @ApiQuery({ name: 'bbox', example: '-79.95,-2.25,-79.85,-2.1' })
  flow(@Query('bbox') bbox?: string) {
    return this.traffic.flow(parseBbox(bbox));
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'Heat map of the last 24 hours of trips (GeoJSON points, cells with 3+ distinct trips)',
  })
  @ApiQuery({ name: 'bbox', example: '-79.95,-2.25,-79.85,-2.1' })
  activity(@Query('bbox') bbox?: string) {
    return this.traffic.activity(parseBbox(bbox));
  }
}
