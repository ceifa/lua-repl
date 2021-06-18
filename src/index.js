import './assets/CascadiaMono.ttf';

import { editor, KeyMod, KeyCode } from 'monaco-editor';
import wasmFile from 'wasmoon/dist/glue.wasm'
import { decorateFunction, LuaFactory } from 'wasmoon';
import defaultScript from './default.lua'

(async () => {
    let startScript = defaultScript

    if (window.pasteFetch) {
        try {
            const res = await window.pasteFetch;
            if (res.ok) {
                startScript = await res.text();
            }
        } catch (err) {
            console.error(err);
        }
    }

    const monacoEditor = editor.create(document.getElementById('editor'), {
        value: startScript,
        language: 'lua',
        theme: 'vs-dark',
        automaticLayout: true,
        fontLigatures: true,
        fontFamily: 'Cascadia Code',
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
            const result = await state.doString(monacoEditor.getValue());
            if (result) {
                addLog(result);
            }
        } catch (err) {
            addLog(err.toString());
        } finally {
            state.global.close();
        }
    };

    await executeLuaCode();

    monacoEditor.addAction({
        id: 'execute-action',
        label: 'Execute code',
        keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_E],
        run: executeLuaCode
    });

    monacoEditor.addAction({
        id: 'save-action',
        label: 'Save code',
        keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_S],
        run: async (editor) => {
            const res = await fetch('https://api.ceifa.tv/documents', {
                method: 'POST',
                body: monacoEditor.getValue()
            });

            if (res.ok) {
                const body = await res.json();
                history.pushState(body, document.title, `?paste=${body.key}`)
            }
        }
    })
})();