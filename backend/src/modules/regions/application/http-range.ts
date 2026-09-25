export interface ByteRange {
  start: number;
  end: number;
}

export type RangeParseResult =
  { type: 'none' } | { type: 'range'; range: ByteRange } | { type: 'unsatisfiable' };

/**
 * Parses a single-range `Range: bytes=...` header (RFC 9110). Multi-range
 * requests are served as a full response, which is allowed by the spec.
 */
export function parseRangeHeader(header: string | undefined, size: number): RangeParseResult {
  if (!header) return { type: 'none' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: 'none' };
  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return { type: 'none' };

  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (suffix === 0) return { type: 'unsatisfiable' };
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  }
  if (start >= size || start > end) return { type: 'unsatisfiable' };
  return { type: 'range', range: { start, end } };
}
