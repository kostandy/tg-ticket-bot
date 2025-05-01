import { defineConfig } from 'vitest/config';

export default defineConfig({
  mode: 'test',
  test: {
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testTimeout: 60000,
    setupFiles: ['dotenv/config']
  }
}); 