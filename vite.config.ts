import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
});
