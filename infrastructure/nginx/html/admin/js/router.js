// Address of each screen of the panel, kept in the URL fragment (#/viajes/<id>?estado=...) so that
// every screen can be bookmarked, shared and reopened after signing in. Pure functions.

/** "#/viajes/abc?status=ACTIVE" -> { segments: ['viajes', 'abc'], query: { status: 'ACTIVE' } }. */
export function parseHash(hash) {
  const text = (hash ?? '').replace(/^#/, '');
  const [path, search = ''] = text.split('?', 2);
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const query = {};
  for (const [name, value] of new URLSearchParams(search)) query[name] = value;
  return { segments, query };
}

/** The opposite of parseHash; empty values are left out. */
export function buildHash(segments, query = {}) {
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(name, String(value));
  }
  const text = search.toString();
  return `#/${path}${text ? `?${text}` : ''}`;
}

/** Query of a list request: page size and offset, plus the filters with a value. */
export function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(name, value.join(','));
      continue;
    }
    search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Offsets of the previous and next pages of a paginated answer ({ total, limit, offset }). */
export function pages({ total, limit, offset }) {
  return {
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + limit, total),
    previous: offset > 0 ? Math.max(0, offset - limit) : null,
    next: offset + limit < total ? offset + limit : null,
  };
}

/** Start (inclusive) and end (exclusive) of calendar days in the browser, as ISO instants. */
export function dayRange(fromDay, toDay) {
  const start = fromDay ? new Date(`${fromDay}T00:00:00`) : null;
  const end = toDay ? new Date(`${toDay}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return {
    from: start && !Number.isNaN(start.getTime()) ? start.toISOString() : undefined,
    to: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
  };
}
