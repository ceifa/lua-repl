import { defineConfig } from 'vite'

export default defineConfig({
    root: 'src',
    publicDir: false,
    define: {
        global: 'globalThis',
    },
    build: {
        outDir: '..dist',
        emptyOutDir: true,
        target: 'es2025',
    },
})
