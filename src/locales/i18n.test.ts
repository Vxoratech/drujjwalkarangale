import { describe, expect, it } from 'vitest';
import { en } from './en';
import { translate } from './i18n';
import { mr } from './mr';

function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keysOf(v as object, `${prefix}${k}.`),
  );
}

describe('i18n', () => {
  it('Marathi covers every English key', () => {
    expect(keysOf(mr).sort()).toEqual(keysOf(en).sort());
  });

  it('has no empty translations', () => {
    for (const dict of [en, mr]) {
      for (const key of keysOf(dict)) {
        expect(translate(dict, key as never).trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates parameters', () => {
    expect(translate(en, 'dashboard.remaining', { count: 3 })).toBe('3 remaining');
    expect(translate(mr, 'common.page', { page: 1, total: 4 })).toBe('पृष्ठ 1 / 4');
  });
});
