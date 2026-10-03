import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    environment: 'node',
    exclude: [...configDefaults.exclude, 'e2e/**', '.kilo/**', 'tests/**'],
  },
});
