/** Longitude/latitude pair, GeoJSON order: [lng, lat]. */
export type Position = [number, number];

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export type BoundingBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export const isValidLatitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180;

export const isValidCoordinate = (c: Coordinate): boolean =>
  isValidLatitude(c.latitude) && isValidLongitude(c.longitude);

export const toPosition = (c: Coordinate): Position => [c.longitude, c.latitude];

export const toPoint = (c: Coordinate): PointGeometry => ({
  type: 'Point',
  coordinates: toPosition(c),
});

export const fromPoint = (point: PointGeometry): Coordinate => ({
  longitude: point.coordinates[0],
  latitude: point.coordinates[1],
});

export const isValidLineString = (value: unknown): value is LineStringGeometry => {
  if (typeof value !== 'object' || value === null) return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return (
    geometry.type === 'LineString' &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(isValidPosition)
  );
};

export const isValidPolygon = (value: unknown): value is PolygonGeometry => {
  if (typeof value !== 'object' || value === null) return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return false;
  const rings = geometry.coordinates as unknown[];
  return (
    rings.length >= 1 &&
    rings.every((ring) => {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isValidPosition)) return false;
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first[0] === last[0] && first[1] === last[1];
    })
  );
};

export const isValidPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number' &&
  isValidLongitude(value[0]) &&
  isValidLatitude(value[1]);

/** Great-circle distance in meters (haversine). */
export const haversineMeters = (a: Coordinate, b: Coordinate): number => {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
