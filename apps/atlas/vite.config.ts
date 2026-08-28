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

function fireflyDisabledWorkerEntries(): Plugin {
  const enabled = process.env.VITE_APP_VARIANT === 'firefly';
  const disabledAudioRuntimeId = '\0firefly-disabled-audio-intelligence-runtime';
  const disabledTranscriberId = '\0firefly-disabled-clip-transcriber';
  const replacements: Array<[string, string, string]> = [
    ['/services/sam2/SAM2Service.ts', "'./sam2Worker.ts'", "'../../firefly/stubs/disabledFeature.worker.ts'"],
    ['/services/transcription/workerClient.ts', "'../../workers/transcriptionWorker.ts'", "'../../firefly/stubs/disabledFeature.worker.ts'"],
    ['/services/audio/stemSeparation/StemSeparationWorkerClient.ts', "'./stemSeparationWorker.ts'", "'../../../firefly/stubs/disabledFeature.worker.ts'"],
    ['/services/faceAnalysis/FaceAnalysisRuntime.ts', "'./faceAnalysisWorker.ts'", "'../../firefly/stubs/disabledFeature.worker.ts'"],
    ['/services/audio/intelligence/AudioIntelligenceRuntime.ts', "'../../../workers/audioIntelligence.worker.ts'", "'../../../firefly/stubs/disabledFeature.worker.ts'"],
    ['/services/sceneCutDetection/sceneCutAnalysisWorkerClient.ts', "'../../workers/sceneCutAnalysisWorker.ts'", "'../../firefly/stubs/disabledFeature.worker.ts'"],
  ];
  return {
    name: 'firefly-disabled-worker-entries',
    enforce: 'pre',
    resolveId(source) {
      if (!enabled) return null;
      const normalizedSource = source.replace(/\\/g, '/');
      if (normalizedSource.endsWith('/AudioIntelligenceRuntime')) {
        return disabledAudioRuntimeId;
      }
      if (normalizedSource.endsWith('/services/clipTranscriber')) {
        return disabledTranscriberId;
      }
      return null;
    },
    load(id) {
      if (id === disabledAudioRuntimeId) {
        return [
          'const unavailable = () => Promise.reject(new Error("Audio intelligence is not available in the Firefly Atlas build."));',
          'const runtime = { loadPcm: unavailable, releasePcm: unavailable, runVad: unavailable, runAlignment: unavailable, runSpeechMarkers: unavailable, runProsody: unavailable, runRoomTone: unavailable };',
          'export function getAudioIntelligenceRuntime() { return runtime; }',
        ].join('\n');
      }
      if (id === disabledTranscriberId) {
        return [
          'const unavailable = () => Promise.reject(new Error("转写功能未在 Firefly Atlas 中开放"));',
          'export const transcribeClip = unavailable;',
          'export function cancelTranscription() {}',
          'export function clearClipTranscript() {}',
        ].join('\n');
      }
      return null;
    },
    transform(code, id) {
      if (!enabled) return null;
      const normalizedId = id.replace(/\\/g, '/');
      const replacement = replacements.find(([suffix]) => normalizedId.endsWith(suffix));
      if (!replacement) return null;
      const [, source, target] = replacement;
      if (!code.includes(source)) throw new Error(`Firefly worker exclusion drifted for ${normalizedId}`);
      return code.replace(source, target);
    },
  };
}

export default defineConfig({
  base: '/studio/atlas/',
  plugins: [
    react(),
    fireflyDisabledWorkerEntries(),
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
    // Vite builds nested workers with a separate Rollup graph. Repeat the
    // Firefly boundary plugin there or hidden legacy analysis imports inside
    // runtimeHost.worker would still emit their ONNX runtimes.
    plugins: () => [fireflyDisabledWorkerEntries()],
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
