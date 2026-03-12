import wasmFile from 'wasmoon/dist/glue.wasm?url'
import { LuaFactory } from 'wasmoon'
import { registerRuntimeHelpers } from './lua-runtime'

const factory = new LuaFactory(wasmFile)

const execute = async (luaCode) => {
    console.clear()

    const state = await factory.createEngine()
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
        state.global.close()
        self.postMessage({ type: 'finished' });
    }
};

self.onmessage = ({ data: { type, data } }) => {
    if (type === 'execute') {
        execute(data)
    }
}
