import { defineConfig } from '@playwright/test';

// A dedicated port, so a manual `npm run preview` on 5201 never serves a stale build to the tests.
const port = 5202;

export default defineConfig({
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Every worker runs SwiftShader; on a small CI runner one at a time keeps timing honest.
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  // A retry that passes still fails the build, so flakiness cannot hide behind retries.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    // SwiftShader keeps WebGL available on GPU-less CI machines. Real-GPU frame
    // timing is measured separately with playtest/bot_mbp.py.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    // 300 back-to-back runs take about five hours: only via `npm run soak`. No
    // tracing: it would record gigabytes and perturb the heap being measured.
    { name: 'soak', testDir: 'tests/soak', timeout: 0, use: { trace: 'off', screenshot: 'off', video: 'off' } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
