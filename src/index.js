import './reset.css';
import 'fontsource-cascadia-code';
import './index.css';
import defaultScript from './default.lua';

import { editor } from 'monaco-editor';
import wasmFile from 'wasmoon/dist/glue.wasm'
import { Lua } from 'wasmoon';

const monacoEditor = editor.create(document.getElementById('editor'), {
    value: defaultScript,
    language: 'lua',
    theme: 'vs-dark',
    automaticLayout: true
});

const output = document.getElementById('output');

const executeLuaCode = () => {
    console.clear();
    output.innerHTML = "";

    const state = new Lua();
    try {
        state.registerStandardLib();
        state.setGlobal('print', (...args) => {
            console.log(...args);

            const log = document.createElement('span');
            log.innerText = args.join('\t');
            output.appendChild(log);
            output.appendChild(document.createElement('br'));
        });
        state.doString(monacoEditor.getValue());
    } finally {
        state.close();
    }
};

Lua.ensureInitialization(wasmFile).then(executeLuaCode);

monacoEditor.addAction({
    id: 'save-action',
    label: 'Save',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S],
    run: async (editor) => {
        await Lua.ensureInitialization(wasmFile);
        executeLuaCode();
    },
});