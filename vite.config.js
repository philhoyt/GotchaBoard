import { defineConfig } from 'vite';
import { resolve }      from 'path';

export default defineConfig({
  root: 'src',

  build: {
    outDir:      '../public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'src/index.html'),
        discover: resolve(__dirname, 'src/discover.html'),
        tags:     resolve(__dirname, 'src/tags.html'),
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api':    'http://localhost:3000',
      '/images': 'http://localhost:3000',
      '/thumbs': 'http://localhost:3000',
    },
  },
});
