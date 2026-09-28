import { CLASS, NativeGraph, RoadClass } from '../native-graph';

/**
 * Builds an in-memory graph.bin with the same layout as the data pipeline (network.py), for tests.
 */
export interface FixtureEdge {
  u: number;
  v: number;
  cls?: RoadClass;
  name?: string;
  ref?: string;
  flags?: number;
  parish?: number;
  /** Interior points [lng, lat]. */
  shape?: [number, number][];
}

export interface FixtureGraph {
  nodes: [number, number][];
  edges: FixtureEdge[];
  parishes?: { code: string; parish?: string; canton?: string; province?: string }[];
}

const haversine = ([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const h =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

export function encodeGraph(fixture: FixtureGraph): Buffer {
  const names: string[] = [];
  const nameId = (value?: string) => {
    if (!value) return -1;
    let index = names.indexOf(value);
    if (index < 0) index = names.push(value) - 1;
    return index;
  };
  const shapeLon: number[] = [];
  const shapeLat: number[] = [];
  const shapeOffset: number[] = [0];
  const lengths: number[] = [];
  for (const edge of fixture.edges) {
    const points = [fixture.nodes[edge.u], ...(edge.shape ?? []), fixture.nodes[edge.v]];
    let length = 0;
    for (let i = 1; i < points.length; i += 1) length += haversine(points[i - 1], points[i]);
    lengths.push(length);
    for (const [lon, lat] of edge.shape ?? []) {
      shapeLon.push(Math.round(lon * 1e7));
      shapeLat.push(Math.round(lat * 1e7));
    }
    shapeOffset.push(shapeLon.length);
  }
  const nameIds = fixture.edges.map((edge) => nameId(edge.name));
  const refIds = fixture.edges.map((edge) => nameId(edge.ref));
  const namesBlob = Buffer.from(names.join(''), 'utf8');
  const namesOffset = [0];
  for (const value of names)
    namesOffset.push(namesOffset[namesOffset.length - 1] + Buffer.byteLength(value));

  const sections: [string, string, ArrayLike<number>][] = [
    ['node_lon', 'int32', fixture.nodes.map(([lon]) => Math.round(lon * 1e7))],
    ['node_lat', 'int32', fixture.nodes.map(([, lat]) => Math.round(lat * 1e7))],
    ['edge_u', 'int32', fixture.edges.map((edge) => edge.u)],
    ['edge_v', 'int32', fixture.edges.map((edge) => edge.v)],
    ['edge_len', 'float32', lengths],
    ['edge_cls', 'uint8', fixture.edges.map((edge) => CLASS[edge.cls ?? 'street'])],
    ['edge_flags', 'uint8', fixture.edges.map((edge) => edge.flags ?? 0)],
    ['edge_name', 'int32', nameIds],
    ['edge_ref', 'int32', refIds],
    ['edge_parish', 'int32', fixture.edges.map((edge) => edge.parish ?? -1)],
    ['shape_off', 'uint32', shapeOffset],
    ['shape_lon', 'int32', shapeLon],
    ['shape_lat', 'int32', shapeLat],
    ['names_off', 'uint32', namesOffset],
    ['names', 'uint8', namesBlob],
  ];
  const chunks: Buffer[] = [];
  const layout: { name: string; type: string; offset: number; length: number }[] = [];
  let size = 0;
  for (const [name, type, values] of sections) {
    const padding = (8 - (size % 8)) % 8;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      size += padding;
    }
    const typed =
      type === 'int32'
        ? Int32Array.from(values)
        : type === 'uint32'
          ? Uint32Array.from(values)
          : type === 'float32'
            ? Float32Array.from(values)
            : Uint8Array.from(values);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    layout.push({ name, type, offset: size, length: values.length });
    chunks.push(Buffer.from(bytes));
    size += bytes.length;
  }
  const header = Buffer.from(
    JSON.stringify({
      format: 'route-maps-graph',
      version: 2,
      classes: Object.keys(CLASS),
      counts: { nodes: fixture.nodes.length, edges: fixture.edges.length, names: names.length },
      parishes: fixture.parishes ?? [],
      sections: layout,
    }),
    'utf8',
  );
  const prefix = Buffer.concat([Buffer.from('RMGRAPH2', 'latin1'), Buffer.alloc(4), header]);
  prefix.writeUInt32LE(header.length, 8);
  const padding = Buffer.alloc((8 - (prefix.length % 8)) % 8, 0x20);
  // Copy into a fresh, 8-byte aligned buffer (Buffer.concat may use the shared pool).
  const total = Buffer.concat([prefix, padding, ...chunks]);
  const aligned = Buffer.from(new ArrayBuffer(total.length));
  total.copy(aligned);
  return aligned;
}

export const fixtureGraph = (fixture: FixtureGraph): NativeGraph =>
  NativeGraph.parse(encodeGraph(fixture));
