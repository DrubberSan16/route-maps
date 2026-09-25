import { ApiProperty } from '@nestjs/swagger';

export class LineStringDto {
  @ApiProperty({ enum: ['LineString'], example: 'LineString' })
  type: 'LineString';

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
    example: [
      [-79.9224, -2.1709],
      [-79.921, -2.169],
    ],
    description: 'Positions in GeoJSON order [longitude, latitude]',
  })
  coordinates: [number, number][];
}

export class PolygonDto {
  @ApiProperty({ enum: ['Polygon'], example: 'Polygon' })
  type: 'Polygon';

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    description: 'Linear rings in GeoJSON order [longitude, latitude]; first ring is the exterior',
  })
  coordinates: [number, number][][];
}
