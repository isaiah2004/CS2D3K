import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': resolve(__dirname, 'src/renderer/src'),
  '@shared': resolve(__dirname, 'src/shared')
}

// Unit tests mirror the source tree (Logseq-style): src/<path>.ts → tests/unit/<path>.test.ts
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts', 'tests/unit/shared/**/*.test.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/unit/helpers/setup-renderer.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'html']
    }
  }
})
