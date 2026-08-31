import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Test the sources, not the build output, so a failure points at real lines.
      // Only the shared package is aliased. Server internals are imported by
      // path so that no test can accidentally boot the real HTTP listener.
      '@bbc/shared': here('./shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    restoreMocks: true,
  },
});
