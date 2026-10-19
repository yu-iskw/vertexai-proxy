import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@vertexai-proxy/server',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
