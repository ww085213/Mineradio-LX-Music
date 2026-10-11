import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron's sandboxed renderer has no Node `process` global. Some bundled
  // CommonJS dependencies still inspect NODE_ENV at runtime unless inlined.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-local',
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    lib: {
      entry: 'src/bridge.tsx',
      name: 'MineradioLyricViz',
      formats: ['iife'],
      fileName: () => 'lyric-viz-bridge.js',
      cssFileName: 'lyric-viz-bridge',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
