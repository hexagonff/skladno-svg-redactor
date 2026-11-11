import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { composeApi } from './scripts/dev-compose';

export default defineConfig(({ mode, command }) => ({
  plugins: [
    react(),
    ...(command === 'serve'
      ? [composeApi(loadEnv(mode, process.cwd(), ''))]
      : []),
  ],
  server: {
    watch: {
      // Wait for saves to finish before invalidating and transforming modules.
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
}));
