import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const wasmoonGlueUrl = fileURLToPath(new URL('./node_modules/wasmoon/dist/glue.wasm', import.meta.url))

export default defineConfig({
    plugins: [
        {
            name: 'wasmoon-glue-url-shim',
            enforce: 'pre',
            resolveId(id) {
                if (id === 'wasmoon/dist/glue.wasm?url') {
                    return '\0wasmoon-glue-url-shim'
                }
            },
            load(id) {
                if (id === '\0wasmoon-glue-url-shim') {
                    return `export default ${JSON.stringify(wasmoonGlueUrl)}`
                }
            },
        },
    ],
    test: {
        environment: 'node',
        include: ['test/**/*.test.js'],
    },
})
