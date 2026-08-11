import { defineConfig } from 'playwright/test'

export default defineConfig({
  fullyParallel: false,
  reporter: 'line',
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm exec vite -- --host 127.0.0.1 --port 41731 --strictPort',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: 'http://127.0.0.1:41731/e2e/terminal.html'
  },
  workers: 1
})
