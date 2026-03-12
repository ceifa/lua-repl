import wasmFile from 'wasmoon/dist/glue.wasm?url'
import { LuaFactory } from 'wasmoon'
import { registerRuntimeHelpers } from './lua-runtime'

let browserFactory
let nodeFactory

const createFactory = customWasmFile => {
    if (customWasmFile) {
        browserFactory ||= new LuaFactory(customWasmFile)
        return browserFactory
    }

    nodeFactory ||= new LuaFactory()
    return nodeFactory
}

const clampLine = (line, totalLines) => Math.min(Math.max(line, 1), Math.max(totalLines, 1))

const parseRuntimeError = (source, message) => {
    const lines = source.split('\n')
    const scopedMatch = message.match(/\[string\s+"editor"\]:(\d+):\s*(.+)$/)
    const genericMatch = message.match(/:(\d+):\s*(.+)$/)
    const [, rawLine = '1', details = message] = scopedMatch || genericMatch || []
    const line = clampLine(Number(rawLine), lines.length)
    const lineText = lines[line - 1] || ''
    const nearToken = details.match(/near '([^']+)'/)
    const eofToken = /near <eof>/.test(details)

    if (eofToken || nearToken?.[1] === '<eof>') {
        const column = lineText.length + 1
        return {
            line,
            startColumn: column,
            endColumn: column + 1,
            message: details,
        }
    }

    if (nearToken?.[1] && nearToken[1] !== '?') {
        const token = nearToken[1]
        const tokenIndex = lineText.lastIndexOf(token)
        if (tokenIndex >= 0) {
            return {
                line,
                startColumn: tokenIndex + 1,
                endColumn: tokenIndex + token.length + 1,
                message: details,
            }
        }
    }

    return {
        line,
        startColumn: 1,
        endColumn: Math.min(lineText.length + 1, 2),
        message: details,
    }
}

export const validateLuaSource = async (source, options = {}) => {
    const factory = createFactory(options.wasmFile || (typeof window !== 'undefined' ? wasmFile : undefined))
    const state = await factory.createEngine()

    try {
        registerRuntimeHelpers(state)
        state.global.set('__editor_source', source)
        const compileError = state.doStringSync('local _, err = load(__editor_source, "editor"); return err')

        if (compileError) {
            const parsed = parseRuntimeError(source, String(compileError))
            return {
                version: options.version,
                diagnostics: [
                    {
                        severity: 'error',
                        code: 'runtime-syntax',
                        message: parsed.message,
                        startLineNumber: parsed.line,
                        startColumn: parsed.startColumn,
                        endLineNumber: parsed.line,
                        endColumn: parsed.endColumn,
                    },
                ],
            }
        }

        return {
            version: options.version,
            diagnostics: [],
        }
    } catch (error) {
        const parsed = parseRuntimeError(source, error.message || String(error))
        return {
            version: options.version,
            diagnostics: [
                {
                    severity: 'error',
                    code: 'runtime-syntax',
                    message: parsed.message,
                    startLineNumber: parsed.line,
                    startColumn: parsed.startColumn,
                    endLineNumber: parsed.line,
                    endColumn: parsed.endColumn,
                },
            ],
        }
    } finally {
        state.global.close()
    }
}
