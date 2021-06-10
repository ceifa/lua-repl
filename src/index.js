import './reset.css';
import 'fontsource-cascadia-code';
import './index.css';
import defaultScript from './default.lua';

import { editor, KeyMod, KeyCode } from 'monaco-editor';
import wasmFile from 'wasmoon/dist/glue.wasm'
import { decorateFunction, LuaFactory } from 'wasmoon';

const monacoEditor = editor.create(document.getElementById('editor'), {
    value: defaultScript,
    language: 'lua',
    theme: 'vs-dark',
    automaticLayout: true
});

const output = document.getElementById('output');

const factory = new LuaFactory(wasmFile);

const executeLuaCode = async () => {
    console.clear();
    output.innerHTML = '';

    const addLog = (str) => {
        const log = document.createElement('span');
        log.innerText = str;
        output.appendChild(log);
        output.appendChild(document.createElement('br'));
    }

    const state = await factory.createEngine();
    try {
        state.global.set('print', decorateFunction((thread, argsQuantity) => {
            const values = [];
            for (let i = 1; i <= argsQuantity; i++) {
                values.push(thread.indexToString(i));
            }

            console.log(...values);
            addLog(values.join('\t'));
        }, {
            receiveArgsQuantity: true,
            receiveThread: true
        }));
        state.doString(monacoEditor.getValue());
    } catch (e) {
        addLog(e.toString());
    } finally {
        state.global.close();
    }
};

executeLuaCode();

monacoEditor.addAction({
    id: 'execute-action',
    label: 'Execute code',
    keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_S],
    run: async (editor) => {
        await executeLuaCode();
    },
});