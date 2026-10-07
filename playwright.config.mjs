import { defineConfig } from '@playwright/test';
// Separate worktrees can test their own build without reusing another worktree's server.
const port = process.env.B8403_TEST_PORT || '4173';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'python3 tools/test-server.py', url: baseURL, reuseExistingServer: true },
});
