import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import {
  GeocodingResultResponse,
  GeocodingSearchQueryDto,
  ReverseGeocodingQueryDto,
} from '../application/dto/geocoding.dto';
import { GeocodingService } from '../application/geocoding.service';

@ApiTags('geocoding')
@Public()
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('search')
  @ApiOperation({ summary: 'Text → coordinates (forward geocoding)' })
  @ApiOkResponse({ type: GeocodingResultResponse, isArray: true })
  search(@Query() query: GeocodingSearchQueryDto) {
    return this.geocoding.search({
      text: query.q,
      limit: query.limit,
      language: query.lang,
      countryCodes: query.countryCodes?.split(','),
      near:
        query.lat !== undefined && query.lng !== undefined
          ? { latitude: query.lat, longitude: query.lng }
          : undefined,
    });
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Coordinates → address (reverse geocoding)' })
  @ApiOkResponse({ type: GeocodingResultResponse })
  reverse(@Query() query: ReverseGeocodingQueryDto) {
    return this.geocoding.reverse(query.lat, query.lng, query.lang);
  }
}
