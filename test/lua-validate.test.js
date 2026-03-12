import { describe, expect, it } from 'vitest'
import { validateLuaSource } from '../src/lua-validate'

describe('lua runtime validation', () => {
    it('accepts Lua 5.4 syntax supported by Wasmoon', async () => {
        const result = await validateLuaSource('local answer <const> = 42\nreturn answer')

        expect(result.diagnostics).toEqual([])
    })

    it('reports syntax failures without executing user code', async () => {
        const result = await validateLuaSource('function (')

        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'runtime-syntax',
                severity: 'error',
            }),
        ])
    })

    it('maps eof syntax errors to the end of the last parsed line', async () => {
        const source = [
            'function broken()',
            '    print("hi")',
        ].join('\n')

        const result = await validateLuaSource(source)

        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'runtime-syntax',
                startLineNumber: 2,
                startColumn: '    print("hi")'.length + 1,
            }),
        ])
    })
})
