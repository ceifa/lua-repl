import { languages, editor } from 'monaco-editor/esm/vs/editor/editor.api.js'
import globals from './globals.json'

let lastGoodAst = null
let luaparsePromise
let luaFmtPromise

const loadLuaparse = async () => {
    if (!luaparsePromise) {
        luaparsePromise = import('luaparse').then(module => module.parse)
    }

    return luaparsePromise
}

const loadLuaFormatter = async () => {
    if (!luaFmtPromise) {
        luaFmtPromise = import('lua-fmt').then(module => module.formatText)
    }

    return luaFmtPromise
}

export const setUpLuaLanguage = () => {
    languages.registerDocumentFormattingEditProvider('lua', {
        displayName: 'Lua formatter',
        async provideDocumentFormattingEdits(model, options, token) {
            let code = model.getValue()
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

    languages.registerCompletionItemProvider('lua', {
        triggerCharacters: ['.'],
        async provideCompletionItems(model, position) {
            const lineContent = model.getLineContent(position.lineNumber)
            const textBeforeCursor = lineContent.substring(0, position.column - 1)
            const singleQuotes = (textBeforeCursor.match(/'/g) || []).length
            const doubleQuotes = (textBeforeCursor.match(/"/g) || []).length
            const insideString = singleQuotes % 2 === 1 || doubleQuotes % 2 === 1
            if (insideString) {
                return { suggestions: [] }
            }

            const suggestions = []
            const word = model.getWordUntilPosition(position)
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            }
            const textUntilPosition = model.getValueInRange({
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: 1,
                endColumn: position.column,
            })
            const dotMatch = textUntilPosition.match(/([\w_\.]+)\.$/)
            const dotChain = dotMatch ? dotMatch[1].split('.') : []

            if (!dotMatch || dotChain.length === 0 || dotChain[0] === '_G') {
                let registeredNames = new Set()
                for (const fullFn of globals.functions) {
                    const name = fullFn.split('.')[0]
                    if (registeredNames.has(name)) continue
                    suggestions.push({
                        label: name,
                        kind: languages.CompletionItemKind.Function,
                        insertText: name,
                        range,
                        sortText: `3${name}`,
                    })
                    registeredNames.add(name)
                }
            } else if (dotChain.length === 1) {
                const tableName = dotChain[0]
                const matchedFunctions = globals.functions.filter(fn => fn.startsWith(`${tableName}.`))
                matchedFunctions.forEach(fullFn => {
                    const shortFnName = fullFn.replace(`${tableName}.`, '')
                    suggestions.push({
                        label: shortFnName,
                        kind: languages.CompletionItemKind.Function,
                        insertText: shortFnName,
                        range,
                        sortText: `1${shortFnName}`,
                    })
                })
            }

            if (!dotMatch || dotChain.length === 0 || dotChain[0] === '_G') {
                suggestions.push(
                    {
                        label: '_G',
                        kind: languages.CompletionItemKind.Variable,
                        insertText: '_G',
                        range,
                        sortText: `3_G`,
                    },
                    {
                        label: '_VERSION',
                        kind: languages.CompletionItemKind.Constant,
                        insertText: '_VERSION',
                        range,
                        sortText: `3_VERSION`,
                    }
                )
            }

            if (!dotMatch) {
                suggestions.push(
                    {
                        label: 'if',
                        kind: languages.CompletionItemKind.Snippet,
                        insertText: 'if ${1:condition} then\n\t$0\nend',
                        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range,
                    },
                    {
                        label: 'for',
                        kind: languages.CompletionItemKind.Snippet,
                        insertText: 'for ${1:i} = ${2:1}, ${3:10} do\n\t$0\nend',
                        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range,
                    },
                    {
                        label: 'function',
                        kind: languages.CompletionItemKind.Snippet,
                        insertText: 'function ${1:functionName}(${2:args})\n\t$0\nend',
                        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range,
                    },
                    {
                        label: 'local',
                        kind: languages.CompletionItemKind.Snippet,
                        insertText: 'local ${1:var} = ${2:value}',
                        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range,
                    }
                )
            }

            let code = model.getValue()
            if (dotMatch) {
                const invalidCode = dotMatch[0]
                code =
                    code.slice(0, model.getOffsetAt(position) - invalidCode.length) +
                    code.slice(model.getOffsetAt(position))
            }

            let ast
            try {
                const parse = await loadLuaparse()
                ast = parse(code, { locations: true, scope: true })
                lastGoodAst = ast
            } catch {
                if (!lastGoodAst) {
                    return { suggestions }
                }
                ast = lastGoodAst
            }

            const cursorPos = { line: position.lineNumber, column: position.column }
            function posLessOrEqual(a, b) {
                if (a.line < b.line) return true
                return a.line === b.line && a.column <= b.column
            }
            function posWithin(startPos, endPos, cur) {
                return posLessOrEqual(startPos, cur) && posLessOrEqual(cur, endPos)
            }
            function makePos(locSide) {
                return { line: locSide.line, column: locSide.column }
            }

            function createScope(startPos, endPos, parentScope) {
                return {
                    startPos,
                    endPos,
                    localDecls: [],
                    children: [],
                    parent: parentScope || null,
                }
            }
            function addChildScope(parent, child) {
                parent.children.push(child)
            }

            const rootStartPos = ast.loc?.start ? makePos(ast.loc.start) : { line: 1, column: 0 }
            const totalLines = model.getLineCount()
            const lastLineLen = model.getLineMaxColumn(totalLines)
            let rootEndPos
            if (ast.loc?.end) {
                const astEnd = makePos(ast.loc.end)
                if (
                    astEnd.line < totalLines ||
                    (astEnd.line === totalLines && astEnd.column < lastLineLen)
                ) {
                    rootEndPos = { line: totalLines, column: lastLineLen }
                } else {
                    rootEndPos = astEnd
                }
            } else {
                rootEndPos = { line: totalLines, column: lastLineLen }
            }
            const rootScope = createScope(rootStartPos, rootEndPos, null)
            let currentScope = rootScope

            const globalVars = new Map()

            function pushScope(node) {
                const newScope = createScope(
                    makePos(node.loc.start),
                    makePos(node.loc.end),
                    currentScope
                )
                addChildScope(currentScope, newScope)
                currentScope = newScope
            }
            function popScope() {
                if (currentScope.parent) {
                    currentScope = currentScope.parent
                }
            }

            function parseTableConstructor(tableExpr) {
                const tableObj = {}
                if (!tableExpr.fields) return tableObj

                for (let field of tableExpr.fields) {
                    if (field.type === 'TableKeyString' && field.key.type === 'Identifier') {
                        const fieldName = field.key.name
                        if (field.value.type === 'TableConstructorExpression') {
                            tableObj[fieldName] = parseTableConstructor(field.value)
                        } else {
                            tableObj[fieldName] =
                                field.value.type === 'FunctionDeclaration'
                                    ? languages.CompletionItemKind.Function
                                    : languages.CompletionItemKind.Field
                        }
                    }
                }
                return tableObj
            }

            function attachTableToVar(scope, varName, tableObj) {
                let s = scope
                while (s) {
                    let decl = s.localDecls.find(d => d.name === varName)
                    if (decl) {
                        decl.tableFields = tableObj
                        return
                    }
                    s = s.parent
                }
            }

            function traverse(node) {
                if (!node || typeof node !== 'object') return

                const blockTypes = [
                    'FunctionDeclaration',
                    'ForNumericStatement',
                    'ForGenericStatement',
                    'DoStatement',
                    'WhileStatement',
                    'RepeatStatement',
                    'IfClause',
                    'ElseifClause',
                    'ElseClause',
                ]

                if (blockTypes.includes(node.type)) {
                    pushScope(node)
                }

                if (node.type === 'LocalStatement' && Array.isArray(node.variables)) {
                    node.variables.forEach((variable, idx) => {
                        if (variable.type === 'Identifier') {
                            const localObj = {
                                name: variable.name,
                                declPos: makePos(node.loc.start),
                                type: languages.CompletionItemKind.Variable,
                            }
                            currentScope.localDecls.push(localObj)

                            if (
                                node.init &&
                                node.init[idx] &&
                                node.init[idx].type === 'TableConstructorExpression'
                            ) {
                                localObj.tableFields = parseTableConstructor(node.init[idx])
                            }
                        }
                    })
                }

                if (node.type === 'ForNumericStatement' && node.variable.type === 'Identifier') {
                    currentScope.localDecls.push({
                        name: node.variable.name,
                        declPos: makePos(node.loc.start),
                        type: languages.CompletionItemKind.Variable,
                    })
                }

                if (node.type === 'ForGenericStatement' && Array.isArray(node.variables)) {
                    node.variables.forEach(v => {
                        if (v.type === 'Identifier') {
                            currentScope.localDecls.push({
                                name: v.name,
                                declPos: makePos(node.loc.start),
                                type: languages.CompletionItemKind.Variable,
                            })
                        }
                    })
                }

                if (node.type === 'FunctionDeclaration') {
                    if (node.identifier && node.identifier.type === 'Identifier') {
                        if (node.isLocal) {
                            currentScope.parent.localDecls.push({
                                name: node.identifier.name,
                                declPos: makePos(node.loc.start),
                                type: languages.CompletionItemKind.Function,
                            })
                        } else {
                            const name = node.identifier.name
                            if (!globalVars.has(name)) {
                                globalVars.set(name, { tableFields: null })
                            }
                        }
                    }
                    if (Array.isArray(node.parameters)) {
                        node.parameters.forEach(param => {
                            if (param.type === 'Identifier') {
                                currentScope.localDecls.push({
                                    name: param.name,
                                    declPos: makePos(node.loc.start),
                                    type: languages.CompletionItemKind.Variable,
                                })
                            }
                        })
                    }
                }

                if (node.type === 'AssignmentStatement' && Array.isArray(node.variables)) {
                    node.variables.forEach((v, idx) => {
                        if (v.type === 'Identifier') {
                            const name = v.name
                            let s = currentScope
                            let foundLocal = false
                            while (s) {
                                if (s.localDecls.some(decl => decl.name === name)) {
                                    foundLocal = true
                                    break
                                }
                                s = s.parent
                            }

                            if (!foundLocal) {
                                if (!globalVars.has(name)) {
                                    globalVars.set(name, { tableFields: null })
                                }

                                if (
                                    node.init &&
                                    node.init[idx] &&
                                    node.init[idx].type === 'TableConstructorExpression'
                                ) {
                                    const tableObj = parseTableConstructor(node.init[idx])
                                    globalVars.set(name, { tableFields: tableObj })
                                } else {
                                    globalVars.set(name, { tableFields: null })
                                }
                            } else {
                                if (
                                    node.init &&
                                    node.init[idx] &&
                                    node.init[idx].type === 'TableConstructorExpression'
                                ) {
                                    const tableObj = parseTableConstructor(node.init[idx])
                                    attachTableToVar(currentScope, name, tableObj)
                                }
                            }
                        }
                    })
                }

                ;['body', 'clauses', 'elseBody'].forEach(prop => {
                    const val = node[prop]
                    if (Array.isArray(val)) {
                        val.forEach(c => traverse(c))
                    } else if (val && typeof val === 'object') {
                        traverse(val)
                    }
                })

                if (blockTypes.includes(node.type)) {
                    popScope()
                }
            }

            traverse(ast)

            function getScopesForCursor(scope, curPos, found = []) {
                if (!scope) return found
                if (posWithin(scope.startPos, scope.endPos, curPos)) {
                    found.push(scope)
                    scope.children.forEach(child => {
                        getScopesForCursor(child, curPos, found)
                    })
                }
                return found
            }
            const scopesUnderCursor = getScopesForCursor(rootScope, cursorPos)

            const localVars = new Map()
            function collectLocals(scope) {
                scope.localDecls.forEach(decl => {
                    if (posLessOrEqual(decl.declPos, cursorPos)) {
                        if (!localVars.has(decl.name)) {
                            localVars.set(decl.name, decl)
                        }
                    }
                })
                if (scope.parent) {
                    collectLocals(scope.parent)
                }
            }
            scopesUnderCursor.forEach(s => {
                collectLocals(s)
            })

            if (!dotMatch) {
                localVars.forEach((decl, name) => {
                    suggestions.push({
                        label: name,
                        kind: languages.CompletionItemKind.Variable,
                        insertText: name,
                        range,
                        sortText: `2${name}`,
                    })
                })
            }

            if (!dotMatch || dotChain.length === 0 || dotChain[0] === '_G') {
                for (const [name] of globalVars) {
                    suggestions.push({
                        label: name,
                        kind: languages.CompletionItemKind.Variable,
                        insertText: name,
                        range,
                        sortText: `2${name}`,
                    })
                }
            }

            if (dotChain.length > 0) {
                let currentObj = null
                const firstPiece = dotChain[0]

                if (localVars.has(firstPiece)) {
                    currentObj = localVars.get(firstPiece)
                } else if (globalVars.has(firstPiece)) {
                    currentObj = globalVars.get(firstPiece)
                }

                for (let i = 1; i < dotChain.length; i++) {
                    if (!currentObj || !currentObj.tableFields) {
                        currentObj = null
                        break
                    }
                    const piece = dotChain[i]
                    if (Object.prototype.hasOwnProperty.call(currentObj.tableFields, piece)) {
                        const maybeNested = currentObj.tableFields[piece]
                        if (typeof maybeNested === 'object') {
                            currentObj = { tableFields: maybeNested }
                        } else {
                            currentObj = null
                            break
                        }
                    } else {
                        currentObj = null
                        break
                    }
                }

                if (textUntilPosition.endsWith('.')) {
                    if (currentObj && currentObj.tableFields) {
                        Object.entries(currentObj.tableFields).forEach(([fieldName, type]) => {
                            suggestions.push({
                                label: fieldName,
                                kind: typeof type === 'number' ? type : languages.CompletionItemKind.Field,
                                insertText: fieldName,
                                range,
                                sortText: `1${fieldName}`,
                            })
                        })
                    }
                }
            }

            return { suggestions }
        },
    })
}
