import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      util: 'util',
      events: 'events',
      buffer: 'buffer',
      process: 'process/browser',
      stream: 'stream-browserify',
    },
  },
  optimizeDeps: {
    include: ['util', 'events', 'buffer', 'process', 'stream', 'stream-browserify', 'readable-stream'],
  },
})
