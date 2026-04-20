import { defineConfig } from 'vite';
import { resolve }      from 'path';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
