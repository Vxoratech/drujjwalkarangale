import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated WCAG 2.2 A/AA checks (axe-core) on the screens that render without
 * a backend. axe finds roughly a third of accessibility issues; keyboard and
 * screen-reader passes are still needed (see docs/RELEASE.md).
 */
const PAGES = [
  { name: 'sign-in', path: '/auth/sign-in' },
  { name: 'sign-up', path: '/auth/sign-up' },
  { name: 'forgot password', path: '/auth/forgot' },
  { name: 'component gallery', path: '/__gallery' },
  { name: 'printed prescription', path: '/__fixtures/prescription?lang=mr&items=4' },
];

for (const { name, path } of PAGES) {
  test(`no WCAG A/AA violations: ${name}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    expect(summary).toEqual([]);
  });
}

test('no WCAG A/AA violations in Marathi', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByRole('button', { name: 'मराठी' }).click();
  await page.getByRole('button', { name: 'साइन इन' }).click(); // show validation messages too
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
