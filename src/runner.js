import wasmFile from 'wasmoon/dist/glue.wasm?url'
import { Lua } from 'wasmoon'
import { registerRuntimeHelpers } from './lua-runtime'

const luaPromise = Lua.load({ wasmFile })

const execute = async (luaCode) => {
    console.clear()

    const lua = await luaPromise
    const state = lua.createState({ traceAllocations: true })
    const startTime = performance.now()
    let memoryUsed
    try {
        registerRuntimeHelpers(state, {
            onLog(values) {
                console.log(...values)
                self.postMessage({ type: 'log', data: values.join('\t') })
            },
            onClear() {
                self.postMessage({ type: 'clear' })
                console.clear()
            },
        })

        // Sync is faster
        // We are inside a web worker, should not worry about blocking the main thread
        const result = state.doStringSync(luaCode)
        if (result) {
            self.postMessage({ type: 'log', data: result })
        }
    } catch (err) {
        self.postMessage({ type: 'error', data: err.toString() })
        console.error(err)
    } finally {
        const duration = performance.now() - startTime
        try {
            memoryUsed = state.global.getMemoryUsed()
        } catch {
            // ignore — state may be in a bad shape
        }
        state.global.close()
        self.postMessage({ type: 'finished', data: { duration, memoryUsed } });
    }
};

self.onmessage = ({ data: { type, data } }) => {
    if (type === 'execute') {
        execute(data)
    }
}
