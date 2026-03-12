import { describe, expect, it } from 'vitest'
import {
    analyzeLua,
    createCompletionItems,
    getVisibleSymbols,
} from '../src/lua-analysis-core'
import { mergeSyntaxDiagnostics, shouldApplyResponse } from '../src/lua-service-client'

const extractCursor = source => {
    const offset = source.indexOf('|')
    const cleanSource = source.slice(0, offset) + source.slice(offset + 1)
    const lines = source.slice(0, offset).split('\n')

    return {
        source: cleanSource,
        position: {
            lineNumber: lines.length,
            column: lines.at(-1).length + 1,
        },
    }
}

describe('lua analysis core', () => {
    it('resolves the innermost local when names are shadowed', () => {
        const { source, position } = extractCursor(`
local value = 1
local function demo()
    local value = 2
    return |
end
`.trim())

        const analysis = analyzeLua({ source })
        const visible = getVisibleSymbols(analysis, position)

        expect(visible.get('value').declPos.line).toBe(3)
    })

    it('reports unknown globals', () => {
        const analysis = analyzeLua({
            source: 'print(missing_name)',
        })

        expect(analysis.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'unknown-global',
                    message: expect.stringContaining("missing_name"),
                }),
            ])
        )
    })

    it('does not flag injected globals as unknown', () => {
        const analysis = analyzeLua({
            source: 'print("ok")\nclear()',
        })

        expect(
            analysis.diagnostics.filter(diagnostic => diagnostic.code === 'unknown-global')
        ).toHaveLength(0)
    })

    it('infers table members for completion', () => {
        const { source, position } = extractCursor(`
local obj = {
    greet = function() end,
    name = "Lua",
    nested = { value = 1 },
}

obj.|
`.trim())

        const analysis = analyzeLua({ source })
        const labels = createCompletionItems(analysis, position).map(item => item.label)

        expect(labels).toEqual(expect.arrayContaining(['greet', 'name', 'nested']))
    })

    it('reports missing members on known tables', () => {
        const analysis = analyzeLua({
            source: 'local obj = { greet = function() end }\nreturn obj.missing',
        })

        expect(analysis.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'unknown-member',
                    message: expect.stringContaining("missing"),
                }),
            ])
        )
    })

    it('maps parser errors to Monaco marker ranges', () => {
        const analysis = analyzeLua({
            source: 'local =',
        })

        expect(analysis.diagnostics).toEqual([
            expect.objectContaining({
                code: 'syntax',
                startLineNumber: 1,
                startColumn: expect.any(Number),
                endLineNumber: 1,
                endColumn: expect.any(Number),
            }),
        ])
    })

    it('rejects stale responses by version', () => {
        expect(shouldApplyResponse(3, 2)).toBe(false)
        expect(shouldApplyResponse(3, 3)).toBe(true)
    })

    it('keeps the static syntax range when runtime validation also fails', () => {
        const merged = mergeSyntaxDiagnostics(
            [
                {
                    code: 'syntax',
                    message: 'old',
                    severity: 'error',
                    startLineNumber: 12,
                    startColumn: 1,
                    endLineNumber: 12,
                    endColumn: 6,
                },
            ],
            [
                {
                    code: 'runtime-syntax',
                    message: 'syntax error near <eof>',
                    severity: 'error',
                    startLineNumber: 15,
                    startColumn: 1,
                    endLineNumber: 15,
                    endColumn: 2,
                },
            ]
        )

        expect(merged).toEqual([
            expect.objectContaining({
                code: 'runtime-syntax',
                message: 'syntax error near <eof>',
                startLineNumber: 12,
                endLineNumber: 12,
            }),
        ])
    })
})
