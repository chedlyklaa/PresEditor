import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // mongodb-memory-server downloads a real mongod binary on first run in
    // a fresh environment — generous timeout so that cold-start doesn't
    // flake the suite; cached runs are seconds, not minutes.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
