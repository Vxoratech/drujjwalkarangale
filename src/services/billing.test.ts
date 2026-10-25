import { describe, expect, it } from 'vitest';
import { previewTotals } from './billing';

describe('previewTotals', () => {
  it('matches the server rounding used in create_invoice()', () => {
    // Same numbers as tests/db/rls.test.ts billing case.
    const t = previewTotals(
      [
        { quantity: 1, unit_price_paise: 50000, tax_rate: 0 },
        { quantity: 2, unit_price_paise: 18000, tax_rate: 12 },
      ],
      5000,
    );
    expect(t).toEqual({ subtotal: 86000, tax: 4320, discount: 5000, total: 85320 });
  });

  it('ignores incomplete lines while typing', () => {
    expect(previewTotals([{ quantity: Number.NaN, unit_price_paise: 100, tax_rate: 0 }], Number.NaN).total).toBe(0);
  });
});
