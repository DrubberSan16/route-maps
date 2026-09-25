import { ApiProperty } from '@nestjs/swagger';
import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';
import { isValidPosition } from '../geo/geojson';

/** A GeoJSON position `[longitude, latitude]` within range. */
export const IsPosition = (options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isPosition',
      validator: {
        validate: (value: unknown) => isValidPosition(value),
        defaultMessage: buildMessage(
          (each) => `${each}$property must be a [longitude, latitude] position`,
          options,
        ),
      },
    },
    options,
  );

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
