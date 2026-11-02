import { expect, test } from '@playwright/test';

/**
 * Print output of the real PrescriptionDocument, filled with fictional data
 * (a 14-medicine Marathi prescription with long instructions).
 */
test.describe('prescription print output', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'PDF rendering is checked once, on desktop Chromium');
  });

  test('hides screen-only chrome and fits A4 width without clipping', async ({ page }) => {
    // Print media emulation keeps the window size, so lay out at A4's printable
    // width (210 mm − 2 × 14 mm margins ≈ 688 CSS px) as a printer would.
    await page.setViewportSize({ width: 688, height: 1100 });
    await page.goto('/__fixtures/prescription?lang=mr&items=14');
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('screen-only')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'औषधपत्र' })).toBeVisible();

    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const article = document.querySelector('article')!;
      const a4 = (210 - 2 * 14) * (96 / 25.4); // printable width at 14 mm margins, in CSS px
      if (article.getBoundingClientRect().width > a4 + 2) out.push(`article ${article.getBoundingClientRect().width}px wider than A4`);
      for (const el of Array.from(article.querySelectorAll<HTMLElement>('td, th, p, dd'))) {
        if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: ${el.textContent?.slice(0, 40)}`);
      }
      for (const row of Array.from(article.querySelectorAll('tr'))) {
        const v = getComputedStyle(row).breakInside;
        if (v !== 'avoid') out.push(`row may split across pages (break-inside: ${v})`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('a long prescription paginates to several A4 pages and keeps private notes out', async ({ page }) => {
    await page.goto('/__fixtures/prescription?lang=mr&items=14');
    await expect(page.getByText('Yogaraj Guggulu')).toBeVisible();
    await expect(page.getByText(/must never print/)).toHaveCount(0);
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(4);
  });

  test('a short English prescription fits on one page', async ({ page }) => {
    await page.goto('/__fixtures/prescription?lang=en&items=3');
    await expect(page.getByRole('heading', { name: 'Prescription' })).toBeVisible();
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});
