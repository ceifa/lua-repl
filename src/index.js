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

    const addLog = (str) => {
        const log = document.createElement('span');
        log.innerText = str;
        output.appendChild(log);
        output.appendChild(document.createElement('br'));
    }

    const state = new Lua();
    try {
        state.registerStandardLib();
        state.setGlobal('print', (...args) => {
            console.log(...args);

            args = args.map(a => {
                if (a === null) {
                    return 'nil'
                } else if (typeof a === 'object') {
                    return '[#table]'
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