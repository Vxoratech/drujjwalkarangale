import { describe, expect, it } from 'vitest';
import { emptyToNull, escapeFilter } from './_helpers';

describe('service helpers', () => {
  it('escapes PostgREST filter metacharacters', () => {
    expect(escapeFilter('a,b(c)%')).toBe('a\\,b\\(c\\)\\%');
  });

  it('converts blank strings to null and trims others', () => {
    expect(emptyToNull({ a: '  ', b: ' x ', c: 3 })).toEqual({ a: null, b: 'x', c: 3 });
  });
});
