import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', '../shared/**/*.test.ts'],
    exclude: ['src/generated/**', 'dist/**', 'test/integration/**'],
    setupFiles: ['reflect-metadata'],
    clearMocks: true,
    restoreMocks: true,
  },
})
