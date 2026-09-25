import { Position } from './geojson';
import { decodePolyline, encodePolyline } from './polyline';

describe('polyline', () => {
  // Reference example of the Google encoded polyline algorithm (precision 5, as OSRM).
  const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const GOOGLE_POINTS: Position[] = [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ];

  it('decodes the reference example into GeoJSON [lng, lat] positions', () => {
    expect(decodePolyline(GOOGLE_EXAMPLE, 5)).toEqual(GOOGLE_POINTS);
  });

  it('encodes the reference example', () => {
    expect(encodePolyline(GOOGLE_POINTS, 5)).toBe(GOOGLE_EXAMPLE);
  });

  it('round-trips precision 6 coordinates (Valhalla) around Guayaquil', () => {
    const points: Position[] = [
      [-79.889722, -2.189412],
      [-79.891011, -2.170998],
      [-79.9, -2.15],
      [-79.95, -2.1],
    ];
    expect(decodePolyline(encodePolyline(points, 6), 6)).toEqual(points);
  });

  it('returns no positions for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(encodePolyline([])).toBe('');
  });

  it('rejects truncated input instead of returning garbage', () => {
    expect(() => decodePolyline(GOOGLE_EXAMPLE.slice(0, -1), 5)).toThrow(
      'Invalid encoded polyline',
    );
  });
});
