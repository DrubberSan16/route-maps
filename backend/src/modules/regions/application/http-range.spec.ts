import { parseRangeHeader } from './http-range';

describe('parseRangeHeader', () => {
  const SIZE = 1000;

  it.each([
    ['absent', undefined],
    ['another unit', 'items=0-10'],
    ['empty positions', 'bytes=-'],
    ['multiple ranges (served whole)', 'bytes=0-10,20-30'],
    ['garbage', 'bytes=abc'],
  ])('ignores %s', (_label, header) => {
    expect(parseRangeHeader(header, SIZE)).toEqual({ type: 'none' });
  });

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=500-', 500, 999],
    ['bytes=990-5000', 990, 999],
    ['bytes=-100', 900, 999],
    ['bytes=-5000', 0, 999],
    ['bytes=999-999', 999, 999],
    ['  bytes=10-19  ', 10, 19],
  ])('%s -> %i-%i', (header, start, end) => {
    expect(parseRangeHeader(header, SIZE)).toEqual({ type: 'range', range: { start, end } });
  });

  it.each(['bytes=1000-', 'bytes=2000-3000', 'bytes=-0', 'bytes=50-10'])(
    '%s is not satisfiable',
    (header) => {
      expect(parseRangeHeader(header, SIZE)).toEqual({ type: 'unsatisfiable' });
    },
  );

  it('resumes an interrupted download from the bytes already on disk', () => {
    const downloaded = 734_003_200;
    const total = 1_073_741_824;
    expect(parseRangeHeader(`bytes=${downloaded}-`, total)).toEqual({
      type: 'range',
      range: { start: downloaded, end: total - 1 },
    });
  });
});
