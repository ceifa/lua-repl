import wasmFile from 'wasmoon/dist/glue.wasm';
import { decorateFunction, LuaFactory } from 'wasmoon';

const factory = new LuaFactory(wasmFile);

const sendLog = log => {
    self.postMessage(log)
};

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
            sendLog(values.join('\t'));
        }, {
            receiveArgsQuantity: true,
            receiveThread: true
        }));
        // Sync is faster
        // We are inside a web worker, should not worry about blocking the main thread
        const result = state.doStringSync(luaCode);
        if (result) {
            sendLog(result);
        }
    } catch (err) {
        sendLog(err.toString());
        console.error(err);
    } finally {
        state.global.close();
        self.postMessage({})
    }
};

self.onmessage = ({ data }) => execute(data);