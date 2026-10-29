import { defineConfig } from 'vitest/config';

// Unit tests cover the pure logic shared by the Worker and the app; they run in Node.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
