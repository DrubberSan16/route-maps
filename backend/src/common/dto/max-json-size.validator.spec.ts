import { IsObject, IsOptional, validateSync } from 'class-validator';
import { MaxJsonSize } from './max-json-size.validator';

class WithMetadata {
  @IsOptional()
  @IsObject()
  @MaxJsonSize(64)
  metadata?: Record<string, unknown>;
}

const errors = (metadata: unknown) =>
  validateSync(Object.assign(new WithMetadata(), { metadata })).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('MaxJsonSize', () => {
  it('accepts values whose JSON fits', () => {
    expect(errors({ vehicle: 'GYE-1234' })).toEqual([]);
    expect(errors(undefined)).toEqual([]);
  });

  it('measures bytes, not characters', () => {
    // 20 × "ñ" is 20 characters but 40 bytes, plus the JSON around it.
    expect(errors({ n: 'ñ'.repeat(20) })).toEqual([]);
    expect(errors({ n: 'ñ'.repeat(30) })).toEqual(['metadata must be at most 64 bytes of JSON']);
  });

  it('rejects values that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errors(circular)).toContain('metadata must be at most 64 bytes of JSON');
  });
});
