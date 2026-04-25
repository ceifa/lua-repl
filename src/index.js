import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import './assets/index.css'
import defaultScript from './default.lua?raw'

self.MonacoEnvironment = {
    getWorker() {
        return new editorWorker()
    },
}

const editorEl = document.getElementById('editor')
const outputEl = document.getElementById('output')
const currentActionEl = document.getElementById('current-action')

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const cmdKey = isMac ? 'Cmd' : 'Ctrl'

for (const el of document.querySelectorAll('[data-cmd-key]')) {
    el.textContent = el.textContent.replace(/Ctrl/g, cmdKey)
}

outputEl.innerHTML = `<span>Press ${cmdKey} + Enter to run the code.</span>`

let monacoEditor
let monacoApi
let runner
let isRunning = false
let luaLanguage

const loadSharedPaste = async () => {
    if (!window.pasteFetch) {
        return null
    }

    try {
        const res = await window.pasteFetch
        return res.ok ? await res.text() : null
    } catch (err) {
        console.error(err)
        return null
    }
}

const applySharedPaste = async () => {
    const pasteCode = await loadSharedPaste()
    if (!pasteCode || !monacoEditor) {
        return
    }

    if (!monacoEditor.getValue() || monacoEditor.getValue() === defaultScript) {
        monacoEditor.setValue(pasteCode)
    }
}

const formatDuration = (ms) => {
    if (ms < 1) return `${ms.toFixed(2)}ms`
    if (ms < 1000) return `${ms.toFixed(0)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const createRunner = () => {
    if (runner && isRunning) {
        runner.terminate()
        runner = undefined
    }

    if (!runner) {
        runner = new Worker(new URL('./runner.js', import.meta.url), {
            name: 'Lua runner',
            type: 'module',
        })
    }

    isRunning = true

    runner.onmessage = ({ data: { type, data } }) => {
        document.getElementById('running')?.remove()

        if (type === 'finished') {
            outputEl.style.color = '#FFFFFF'
            isRunning = false
            if (data) {
                const statsEl = document.createElement('div')
                statsEl.className = 'stats'
                const parts = [formatDuration(data.duration)]
                if (typeof data.memoryUsed === 'number') {
                    parts.push(formatBytes(data.memoryUsed))
                }
                statsEl.innerText = parts.join(' · ')
                outputEl.appendChild(statsEl)
            }
        } else if (type === 'log') {
            const logEl = document.createElement('pre')
            logEl.innerText = data
            outputEl.appendChild(logEl)
        } else if (type === 'error') {
            const logEl = document.createElement('span')
            logEl.innerText = data
            logEl.style.color = '#FF0000'
            outputEl.appendChild(logEl)
        } else if (type === 'clear') {
            outputEl.innerHTML = ''
        }
    }

    return runner
}

const stopLua = () => {
    if (runner && isRunning) {
        runner.terminate()
        runner = undefined
        outputEl.style.color = '#FFFFFF'
        isRunning = false
    }
}

const runLua = () => {
    if (!monacoEditor) {
        return
    }

    outputEl.style.color = '#888888'
    outputEl.innerHTML = '<span id="running">Running...</span>'

    createRunner().postMessage({
        type: 'execute',
        data: monacoEditor.getValue(),
    })
}

const setEditorActions = () => {
    const { KeyMod, KeyCode } = monacoApi

    monacoEditor.addAction({
        id: 'execute-action',
        label: 'Execute code',
        keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
        run: runLua,
    })

    monacoEditor.addAction({
        id: 'stop-action',
        label: 'Stop running code',
        keybindings: [KeyMod.CtrlCmd | KeyCode.Period],
        run: stopLua,
    })

    monacoEditor.addAction({
        id: 'save-action',
        label: 'Save code',
        keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS],
        run: async () => {
            try {
                currentActionEl.innerText = 'Saving...'

                const res = await fetch('https://api.ceifa.dev/documents', {
                    method: 'POST',
                    body: monacoEditor.getValue(),
                })

                if (res.ok) {
                    const body = await res.json()
                    history.pushState(body, document.title, `?paste=${body.key}`)
                }

                await navigator.clipboard.writeText(location.href)
                currentActionEl.innerText = 'Copied to clipboard'
            } finally {
                setTimeout(() => {
                    currentActionEl.innerText = ''
                }, 3000)
            }
        },
    })
}

const loadEditor = async () => {
    const [monacoModule, luaLanguageModule] = await Promise.all([
        import('monaco-editor/esm/vs/editor/editor.api.js'),
        import('./monacolua.js'),
    ])

    monacoApi = monacoModule
    luaLanguage = luaLanguageModule.setUpLuaLanguage()

    monacoEditor = monacoApi.editor.create(editorEl, {
        value: defaultScript,
        language: 'lua',
        theme: 'vs-dark',
        automaticLayout: true,
        fontLigatures: true,
        fontFamily: 'Cascadia Code',
        minimap: {
            enabled: false,
        },
        scrollBeyondLastLine: false,
    })

    setEditorActions()
    luaLanguage.attachToEditor(monacoEditor)
    editorEl.dataset.ready = 'true'

    applySharedPaste().catch(err => {
        console.error(err)
    })
}

loadEditor().catch(err => {
    console.error(err)
    editorEl.dataset.failed = 'true'
    outputEl.style.color = '#FF0000'
    outputEl.innerText = 'Failed to load editor.'
})
