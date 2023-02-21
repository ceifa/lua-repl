import wasmFile from 'wasmoon/dist/glue.wasm';
import { decorateFunction, LuaFactory } from 'wasmoon';

const factory = new LuaFactory(wasmFile);

const execute = async (luaCode) => {
    console.clear();

    const state = await factory.createEngine();
    try {
        state.global.set('print', decorateFunction((thread, argsQuantity) => {
            const values = [];
            for (let i = 1; i <= argsQuantity; i++) {
                values.push(thread.indexToString(i));
            }

            console.log(...values);
            self.postMessage({ type: 'log', data: values.join('\t') });
        }, {
            receiveArgsQuantity: true,
            receiveThread: true
        }));

        state.global.set('clear', () => {
            self.postMessage({ type: 'clear' });
            console.clear()
        });

        // Sync is faster
        // We are inside a web worker, should not worry about blocking the main thread
        const result = state.doStringSync(luaCode);
        if (result) {
            self.postMessage({ type: 'log', data: result });
        }
    } catch (err) {
        self.postMessage({ type: 'error', data: err.toString() });
        console.error(err);
    } finally {
        state.global.close();
        self.postMessage({ type: 'finished' });
    }
};

self.onmessage = ({ data: { type, data } }) => {
    if (type === 'execute') {
        execute(data);
    }
}