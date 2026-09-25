import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude } from 'class-validator';

export class CoordinateDto {
  @ApiProperty({ example: -2.1709, minimum: -90, maximum: 90 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -79.9224, minimum: -180, maximum: 180 })
  @IsLongitude()
  longitude: number;
}
