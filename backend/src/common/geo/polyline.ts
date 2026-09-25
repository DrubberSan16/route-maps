import { Position } from './geojson';

/**
 * Decodes an encoded polyline (Google polyline algorithm) into GeoJSON
 * positions ([lng, lat]). Valhalla uses precision 6, OSRM precision 5.
 */
export function decodePolyline(encoded: string, precision = 6): Position[] {
  const factor = 10 ** precision;
  const positions: Position[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Invalid encoded polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lng += next();
    positions.push([
      Number((lng / factor).toFixed(precision)),
      Number((lat / factor).toFixed(precision)),
    ]);
  }
  return positions;
}

/** Encodes GeoJSON positions ([lng, lat]) as a polyline. */
export function encodePolyline(positions: Position[], precision = 6): string {
  const factor = 10 ** precision;
  let output = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    output += String.fromCharCode(v + 63);
  };
  for (const [lngValue, latValue] of positions) {
    const lat = Math.round(latValue * factor);
    const lng = Math.round(lngValue * factor);
    encode(lat - prevLat);
    encode(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}
