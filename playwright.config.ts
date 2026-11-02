import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * By default the app is served against an UNREACHABLE placeholder backend, so
 * the suite never touches real data: it covers the screens and layouts that
 * render without a session (sign-in, Marathi, responsive, print fixtures).
 * The authenticated clinic flow (e2e/clinic-flow.spec.ts) runs only when
 * E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD point at
 * a disposable test project with a seeded demo clinic.
 */
const PORT = 4180;
const live = Boolean(process.env.E2E_SUPABASE_URL && process.env.E2E_EMAIL);
// Fake anon JWT ({"role":"anon"}); never a real key.
const PLACEHOLDER_KEY = 'e30.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImUyZS1wbGFjZWhvbGRlciJ9.e30';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'tablet', use: { ...devices['iPad Mini'], browserName: 'chromium' } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: live ? process.env.E2E_SUPABASE_URL! : 'http://127.0.0.1:59999',
      VITE_SUPABASE_ANON_KEY: live ? process.env.E2E_SUPABASE_ANON_KEY! : PLACEHOLDER_KEY,
      VITE_APP_ENV: 'development',
    },
  },
});
