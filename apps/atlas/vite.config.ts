import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { APP_VERSION } from './src/version';

function splatTransformWebpWasmPathFix(): Plugin {
  return {
    name: 'splat-transform-webp-wasm-path-fix',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.endsWith('/node_modules/@playcanvas/splat-transform/dist/index.mjs')) {
        return null;
      }

      return code.replace(
        /new URL\("webp\.wasm",\s*import\.meta\.url\)\.href/g,
        'new URL("../lib/webp.wasm", import.meta.url).href',
      );
    },
  };
}

export default defineConfig({
  base: '/studio/atlas/',
  plugins: [
    react(),
    splatTransformWebpWasmPathFix(),
    {
      name: 'html-version-replace',
      transformIndexHtml(html) {
        return html.replace(/__APP_VERSION__/g, APP_VERSION);
      },
    },
  ],
  resolve: {
    alias: {
      module: path.resolve(__dirname, 'src/shims/nodeModule.ts'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __SHOW_CHANGELOG__: true,
    __DEV_BRIDGE_TOKEN__: JSON.stringify(''),
    __DEV_ALLOWED_FILE_ROOTS__: JSON.stringify([]),
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Origin-Agent-Cluster': '?1',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Origin-Agent-Cluster': '?1',
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.message.includes('dynamic import will not move module into another chunk')) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          mp4box: ['mp4box'],
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
});
