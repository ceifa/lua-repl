import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js'
import { languages, editor, MarkerSeverity } from 'monaco-editor/esm/vs/editor/editor.api.js'
import luaServiceWorker from './lua-service.worker?worker'
import {
    mergeDiagnostics,
    mergeSyntaxDiagnostics,
    shouldApplyResponse,
} from './lua-service-client'

let luaFmtPromise
let languageSetup

const MARKER_OWNER = 'lua-intelligence'
const ANALYZE_DELAY_MS = 120
const VALIDATE_DELAY_MS = 350

const runWhenIdle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) {
        return window.requestIdleCallback(task, { timeout })
    }

    return window.setTimeout(task, 1)
}

const cancelIdleTask = handle => {
    if (!handle) {
        return
    }

    if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(handle)
        return
    }

    window.clearTimeout(handle)
}

const loadLuaFormatter = async () => {
    if (!luaFmtPromise) {
        luaFmtPromise = import('lua-fmt').then(module => module.formatText)
    }

    return luaFmtPromise
}

const completionKindMap = {
    constant: languages.CompletionItemKind.Constant,
    field: languages.CompletionItemKind.Field,
    function: languages.CompletionItemKind.Function,
    keyword: languages.CompletionItemKind.Keyword,
    method: languages.CompletionItemKind.Method,
    parameter: languages.CompletionItemKind.Variable,
    snippet: languages.CompletionItemKind.Snippet,
    string: languages.CompletionItemKind.Text,
    table: languages.CompletionItemKind.Module,
    variable: languages.CompletionItemKind.Variable,
}

const toMarkerSeverity = severity => {
    switch (severity) {
        case 'error':
            return MarkerSeverity.Error
        case 'warning':
            return MarkerSeverity.Warning
        default:
            return MarkerSeverity.Info
    }
}

class LuaLanguageService {
    constructor() {
        this.worker = new luaServiceWorker({ name: 'Lua analysis worker', type: 'module' })
        this.pending = new Map()
        this.nextRequestId = 0
        this.modelStates = new Map()

        this.worker.onmessage = ({ data }) => {
            const pending = this.pending.get(data.id)
            if (!pending) {
                return
            }

            this.pending.delete(data.id)
            pending.resolve(data.response)
        }

        this.worker.onerror = error => {
            for (const pending of this.pending.values()) {
                pending.reject(error)
            }

            this.pending.clear()
        }
    }

    dispose() {
        this.worker.terminate()
        this.pending.clear()
    }

    callWorker(type, request) {
        const id = ++this.nextRequestId

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            this.worker.postMessage({ id, type, request })
        })
    }

    ensureModelState(model) {
        const uri = model.uri.toString()
        if (!this.modelStates.has(uri)) {
            this.modelStates.set(uri, {
                model,
                latestVersion: model.getVersionId(),
                analysisDiagnostics: [],
                runtimeDiagnostics: [],
                validationStatus: 'idle',
                analyzeTimer: undefined,
                validateTimer: undefined,
                idleHandle: undefined,
            })
        }

        return this.modelStates.get(uri)
    }

    clearModelState(uri) {
        const state = this.modelStates.get(uri)
        if (!state) {
            return
        }

        window.clearTimeout(state.analyzeTimer)
        window.clearTimeout(state.validateTimer)
        cancelIdleTask(state.idleHandle)
        this.modelStates.delete(uri)
    }

    updateMarkers(model, state) {
        const diagnostics =
            state.validationStatus === 'failed'
                ? mergeSyntaxDiagnostics(state.analysisDiagnostics, state.runtimeDiagnostics)
                : state.validationStatus === 'passed'
                    ? state.analysisDiagnostics.filter(diagnostic => diagnostic.code !== 'syntax')
                    : mergeDiagnostics(state.analysisDiagnostics, state.runtimeDiagnostics)

        editor.setModelMarkers(
            model,
            MARKER_OWNER,
            diagnostics.map(diagnostic => ({
                ...diagnostic,
                severity: toMarkerSeverity(diagnostic.severity),
            }))
        )
    }

    scheduleAnalysis(model) {
        const state = this.ensureModelState(model)
        state.latestVersion = model.getVersionId()
        state.validationStatus = 'pending'
        state.runtimeDiagnostics = []

        window.clearTimeout(state.analyzeTimer)
        state.analyzeTimer = window.setTimeout(() => {
            const request = {
                uri: model.uri.toString(),
                version: model.getVersionId(),
                source: model.getValue(),
            }

            this.callWorker('analyze', request)
                .then(response => {
                    if (!shouldApplyResponse(model.getVersionId(), response.version)) {
                        return
                    }

                    state.analysisDiagnostics = response.diagnostics
                    this.updateMarkers(model, state)
                })
                .catch(error => {
                    console.error(error)
                })
        }, ANALYZE_DELAY_MS)
    }

    scheduleValidation(model) {
        const state = this.ensureModelState(model)

        window.clearTimeout(state.validateTimer)
        cancelIdleTask(state.idleHandle)

        state.validateTimer = window.setTimeout(() => {
            state.idleHandle = runWhenIdle(() => {
                const request = {
                    uri: model.uri.toString(),
                    version: model.getVersionId(),
                    source: model.getValue(),
                }

                this.callWorker('validate', request)
                    .then(response => {
                        if (!shouldApplyResponse(model.getVersionId(), response.version)) {
                            return
                        }

                        state.runtimeDiagnostics = response.diagnostics
                        state.validationStatus = response.diagnostics.length > 0 ? 'failed' : 'passed'
                        this.updateMarkers(model, state)
                    })
                    .catch(error => {
                        console.error(error)
                    })
            })
        }, VALIDATE_DELAY_MS)
    }

    async provideCompletionItems(model, position) {
        const suggestions = await this.callWorker('complete', {
            uri: model.uri.toString(),
            version: model.getVersionId(),
            source: model.getValue(),
            position,
        })

        if (!shouldApplyResponse(model.getVersionId(), suggestions.version)) {
            return { suggestions: [] }
        }

        const word = model.getWordUntilPosition(position)
        const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
        }

        return {
            suggestions: suggestions.suggestions.map(item => ({
                label: item.label,
                kind: completionKindMap[item.kind] || languages.CompletionItemKind.Variable,
                insertText: item.insertText,
                detail: item.detail,
                documentation: item.documentation,
                range,
                sortText: item.sortText,
                insertTextRules:
                    item.insertTextRules === 'snippet'
                        ? languages.CompletionItemInsertTextRule.InsertAsSnippet
                        : undefined,
            })),
        }
    }

    attachToEditor(editorInstance) {
        const disposables = []
        const scheduleCurrentModel = () => {
            const model = editorInstance.getModel()
            if (!model) {
                return
            }

            this.ensureModelState(model)
            this.scheduleAnalysis(model)
            this.scheduleValidation(model)
        }

        disposables.push(
            editorInstance.onDidChangeModelContent(() => {
                scheduleCurrentModel()
            })
        )

        disposables.push(
            editorInstance.onDidChangeModel(event => {
                if (event.oldModelUrl) {
                    const oldUri = event.oldModelUrl.toString()
                    const oldState = this.modelStates.get(oldUri)
                    if (oldState?.model) {
                        editor.setModelMarkers(oldState.model, MARKER_OWNER, [])
                    }
                    this.clearModelState(oldUri)
                }

                scheduleCurrentModel()
            })
        )

        const currentModel = editorInstance.getModel()
        if (currentModel) {
            const disposable = currentModel.onWillDispose(() => {
                const uri = currentModel.uri.toString()
                editor.setModelMarkers(currentModel, MARKER_OWNER, [])
                this.clearModelState(uri)
            })
            disposables.push(disposable)
        }

        scheduleCurrentModel()

        return {
            dispose: () => {
                disposables.forEach(disposable => disposable.dispose())
            },
        }
    }
}

export const setUpLuaLanguage = () => {
    if (languageSetup) {
        return languageSetup
    }

    const service = new LuaLanguageService()
    const registrations = []

    registrations.push(
        languages.registerDocumentFormattingEditProvider('lua', {
            displayName: 'Lua formatter',
            async provideDocumentFormattingEdits(model, options) {
                const code = model.getValue()
                try {
                    const formatText = await loadLuaFormatter()
                    return [
                        {
                            eol: editor.EndOfLineSequence.LF,
                            range: model.getFullModelRange(),
                            text: formatText(code, {
                                useTabs: !options.insertSpaces,
                                indentCount: options.tabSize,
                                quotemark: 'double',
                            }),
                        },
                    ]
                } catch {
                    return []
                }
            },
        })
    )

    registrations.push(
        languages.registerCompletionItemProvider('lua', {
            triggerCharacters: ['.', ':'],
            provideCompletionItems: (model, position) => service.provideCompletionItems(model, position),
        })
    )

    languageSetup = {
        attachToEditor(editorInstance) {
            return service.attachToEditor(editorInstance)
        },
        dispose() {
            registrations.forEach(registration => registration.dispose())
            service.dispose()
            languageSetup = undefined
        },
    }

    return languageSetup
}
