import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default env is node; DOM tests opt in per-file with
    // `// @vitest-environment jsdom` (same convention as the portal suite).
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
