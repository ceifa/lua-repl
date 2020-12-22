import './reset.css';
import 'fontsource-cascadia-code';
import './index.css';
import defaultScript from './default.lua';

import { editor } from 'monaco-editor';
import wasmFile from 'wasmoon/dist/glue.wasm'
import { LuaFactory } from 'wasmoon';

const monacoEditor = editor.create(document.getElementById('editor'), {
    value: defaultScript,
    language: 'lua',
    theme: 'vs-dark',
    automaticLayout: true
});

const output = document.getElementById('output');

const executeLuaCode = async () => {
    console.clear();
    output.innerHTML = "";

    const addLog = (str) => {
        const log = document.createElement('span');
        log.innerText = str;
        output.appendChild(log);
        output.appendChild(document.createElement('br'));
    }

    const state = await new LuaFactory(wasmFile).createEngine();
    try {
        state.global.set('print', (...args) => {
            console.log(...args);

            args = args.map(a => {
                if (a === null) {
                    return 'nil'
                } else if (typeof a === 'object') {
                    return '[#table]'
                } else if (typeof a === 'function') {
                    return '[#function]'
                } else {
                    return a
                }
            });

            addLog(args.join('\t'))
        });
        state.doString(monacoEditor.getValue());
    } catch (e) {
        addLog(e.toString())
    } finally {
        state.global.close();
    }
};

executeLuaCode();

monacoEditor.addAction({
    id: 'save-action',
    label: 'Save',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S],
    run: async (editor) => {
        await executeLuaCode();
    },
});