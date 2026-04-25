import * as luaparse from 'luaparse'
import {
    LUA_ENVIRONMENT_MANIFEST,
    LUA_KEYWORDS,
    LUA_SNIPPETS,
} from './lua-environment'

const BLOCK_SCOPE_TYPES = new Set([
    'FunctionDeclaration',
    'ForNumericStatement',
    'ForGenericStatement',
    'DoStatement',
    'WhileStatement',
    'RepeatStatement',
    'IfClause',
    'ElseifClause',
    'ElseClause',
])

const createPosition = (line, column) => ({ line, column })

const makePosition = side => createPosition(side.line, side.column)

const comparePosition = (left, right) => {
    if (left.line !== right.line) {
        return left.line - right.line
    }

    return left.column - right.column
}

const isPositionWithin = (position, start, end) =>
    comparePosition(position, start) >= 0 && comparePosition(position, end) <= 0

const toMarkerRange = (start, end) => ({
    startLineNumber: start.line,
    startColumn: start.column + 1,
    endLineNumber: end.line,
    endColumn: Math.max(start.column + 2, end.column + 1),
})

const createScope = (id, start, end, parent, type) => ({
    id,
    type,
    start,
    end,
    parent,
    children: [],
    locals: [],
})

const createDescriptor = (kind = 'value', extra = {}) => ({
    kind,
    members: undefined,
    signature: undefined,
    documentation: undefined,
    readonly: false,
    table: undefined,
    injected: false,
    ...extra,
})

const cloneDescriptor = descriptor => {
    if (!descriptor) {
        return undefined
    }

    return {
        ...descriptor,
        members: descriptor.members
            ? Object.fromEntries(
                Object.entries(descriptor.members).map(([name, member]) => [name, cloneDescriptor(member)])
            )
            : undefined,
    }
}

const mergeDescriptor = (target, source) => {
    if (!source) {
        return target
    }

    if (!target) {
        return cloneDescriptor(source)
    }

    const merged = {
        ...target,
        ...source,
        members: target.members ? { ...target.members } : undefined,
    }

    if (source.members) {
        merged.members ||= {}
        for (const [name, member] of Object.entries(source.members)) {
            merged.members[name] = mergeDescriptor(merged.members[name], member)
        }
    }

    return merged
}

const functionLikeKinds = new Set(['function', 'method'])

const keywordSuggestions = LUA_KEYWORDS.map(keyword => ({
    label: keyword,
    kind: 'keyword',
    insertText: keyword,
    detail: 'Lua keyword',
    sortText: `4-${keyword}`,
}))

const baseCompletions = [...keywordSuggestions, ...LUA_SNIPPETS]

const createDiagnostic = (severity, message, start, end, code) => ({
    severity,
    message,
    code,
    ...toMarkerRange(start, end),
})

const getOffsetAtPosition = (source, position) =>
    source
        .split('\n')
        .slice(0, position.lineNumber - 1)
        .reduce((total, line) => total + line.length + 1, 0) + (position.column - 1)

const sanitizeSourceForCompletion = (source, position) => {
    const offset = getOffsetAtPosition(source, position)
    const prefix = source.slice(0, offset)
    const suffix = source.slice(offset)
    const linePrefix = prefix.split('\n').at(-1) || ''
    const match = linePrefix.match(/([A-Za-z_][\w]*(?:[.:][A-Za-z_][\w]*)*[.:])$/)

    if (!match) {
        return source
    }

    return prefix.slice(0, prefix.length - match[1].length) + ' '.repeat(match[1].length) + suffix
}

const isNode = value => Boolean(value && typeof value === 'object' && typeof value.type === 'string')

const forEachChildNode = (node, visit) => {
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'range') {
            continue
        }

        if (Array.isArray(value)) {
            value.forEach(entry => {
                if (isNode(entry)) {
                    visit(entry)
                }
            })
            continue
        }

        if (isNode(value)) {
            visit(value)
        }
    }
}

const buildFunctionSignature = (node, fallbackName = 'function') => {
    const parameterNames = []

    if (node.identifier?.type === 'MemberExpression' && node.identifier.indexer === ':') {
        parameterNames.push('self')
    }

    for (const parameter of node.parameters || []) {
        if (parameter.type === 'Identifier') {
            parameterNames.push(parameter.name)
        } else if (parameter.type === 'VarargLiteral') {
            parameterNames.push('...')
        }
    }

    return `${fallbackName}(${parameterNames.join(', ')})`
}

function inferTableMembers(tableNode) {
    const members = {}

    for (const field of tableNode.fields || []) {
        if (field.type === 'TableKeyString' && field.key?.type === 'Identifier') {
            members[field.key.name] = inferValueDescriptor(field.value, 'field')
            continue
        }

        if (
            field.type === 'TableKey' &&
            (field.key?.type === 'Identifier' || field.key?.type === 'StringLiteral')
        ) {
            const name = field.key.name || field.key.value
            members[name] = inferValueDescriptor(field.value, 'field')
        }
    }

    return members
}

const inferValueDescriptor = (node, fallbackKind = 'value') => {
    if (!node) {
        return createDescriptor(fallbackKind)
    }

    switch (node.type) {
        case 'FunctionDeclaration':
            return createDescriptor('function', {
                signature: buildFunctionSignature(node, 'function'),
            })
        case 'TableConstructorExpression':
            return createDescriptor('table', {
                members: inferTableMembers(node),
            })
        case 'StringLiteral':
            return createDescriptor('string')
        case 'NumericLiteral':
            return createDescriptor('number')
        case 'BooleanLiteral':
            return createDescriptor('boolean')
        case 'NilLiteral':
            return createDescriptor('nil')
        default:
            return createDescriptor(fallbackKind)
    }
}

const getEnvironmentDescriptor = (name, environment = LUA_ENVIRONMENT_MANIFEST) => {
    const global = environment.globals[name]
    if (!global) {
        return undefined
    }

    let descriptor = cloneDescriptor(global)

    if (descriptor.table && environment.tables[descriptor.table]) {
        descriptor = mergeDescriptor(
            descriptor,
            createDescriptor('table', {
                members: cloneDescriptor({ members: environment.tables[descriptor.table].members }).members,
                documentation: environment.tables[descriptor.table].documentation,
                readonly: descriptor.readonly,
            })
        )
    }

    return descriptor
}

const resolveScopeAtPosition = (scope, position) => {
    if (!isPositionWithin(position, scope.start, scope.end)) {
        return undefined
    }

    for (const child of scope.children) {
        const resolved = resolveScopeAtPosition(child, position)
        if (resolved) {
            return resolved
        }
    }

    return scope
}

const collectVisibleLocals = (scope, position) => {
    const locals = new Map()
    let current = scope

    while (current) {
        for (let index = current.locals.length - 1; index >= 0; index -= 1) {
            const local = current.locals[index]
            if (comparePosition(local.visibleFrom, position) <= 0 && !locals.has(local.name)) {
                locals.set(local.name, local)
            }
        }

        current = current.parent
    }

    return locals
}

const resolveSymbolDescriptor = (analysis, name, scope, position) => {
    const visibleLocals = collectVisibleLocals(scope, position)
    if (visibleLocals.has(name)) {
        return visibleLocals.get(name)
    }

    if (analysis.globals.has(name)) {
        return analysis.globals.get(name)
    }

    return getEnvironmentDescriptor(name, analysis.environment)
}

const memberExpressionToSegments = node => {
    if (!node) {
        return null
    }

    if (node.type === 'Identifier') {
        return {
            segments: [node.name],
            indexers: [],
        }
    }

    if (node.type === 'MemberExpression' && node.identifier?.type === 'Identifier') {
        const base = memberExpressionToSegments(node.base)
        if (!base) {
            return null
        }

        return {
            segments: [...base.segments, node.identifier.name],
            indexers: [...base.indexers, node.indexer || '.'],
        }
    }

    return null
}

const ensureUserGlobal = (analysis, name, position, kind = 'variable') => {
    if (!analysis.globals.has(name)) {
        analysis.globals.set(name, {
            name,
            kind,
            declPos: position,
            visibleFrom: position,
            members: undefined,
            signature: undefined,
            documentation: undefined,
            readonly: false,
            injected: false,
            table: undefined,
            synthetic: false,
            source: 'user',
        })
    }

    return analysis.globals.get(name)
}

const attachDescriptorToSymbol = (symbol, descriptor) => {
    if (!descriptor) {
        return symbol
    }

    symbol.kind = descriptor.kind || symbol.kind
    symbol.signature = descriptor.signature || symbol.signature
    symbol.documentation = descriptor.documentation || symbol.documentation
    symbol.readonly = Boolean(symbol.readonly || descriptor.readonly)
    symbol.injected = Boolean(symbol.injected || descriptor.injected)
    symbol.table = descriptor.table || symbol.table

    if (descriptor.members) {
        symbol.members = mergeDescriptor(
            createDescriptor(symbol.kind, { members: symbol.members }),
            createDescriptor(symbol.kind, { members: descriptor.members })
        ).members
    }

    return symbol
}

const ensureNestedMembers = (rootDescriptor, pathSegments) => {
    let current = rootDescriptor

    for (const segment of pathSegments) {
        current.members ||= {}
        current.members[segment] ||= createDescriptor('table', { members: {} })
        current = current.members[segment]
    }

    return current
}

const declareLocal = (scope, name, kind, declPos, visibleFrom, extra = {}) => {
    const symbol = {
        name,
        kind,
        declPos,
        visibleFrom,
        members: undefined,
        signature: extra.signature,
        documentation: extra.documentation,
        readonly: false,
        injected: false,
        table: undefined,
        synthetic: Boolean(extra.synthetic),
        source: 'local',
    }

    scope.locals.push(symbol)
    return symbol
}

const resolveDescriptorAtChain = (analysis, segments, scope, position) => {
    if (!segments.length) {
        return undefined
    }

    let descriptor = resolveSymbolDescriptor(analysis, segments[0], scope, position)
    if (!descriptor) {
        return undefined
    }

    for (const segment of segments.slice(1)) {
        if (!descriptor.members || !descriptor.members[segment]) {
            return undefined
        }

        descriptor = descriptor.members[segment]
    }

    return descriptor
}

const addScopeSummary = (analysis, scope) => {
    for (const local of scope.locals) {
        analysis.symbols.push({
            name: local.name,
            kind: local.kind,
            scope: 'local',
            line: local.declPos.line,
            column: local.declPos.column + 1,
        })
    }

    for (const child of scope.children) {
        addScopeSummary(analysis, child)
    }
}

const addMissingMemberDiagnostic = (analysis, descriptor, memberNode, position) => {
    if (!descriptor?.members) {
        return
    }

    const memberName = memberNode.identifier?.name
    if (!memberName || descriptor.members[memberName]) {
        return
    }

    analysis.diagnostics.push(
        createDiagnostic(
            'warning',
            `Unknown member '${memberName}' on statically known table.`,
            position,
            createPosition(position.line, position.column + memberName.length),
            'unknown-member'
        )
    )
}

const shouldIgnoreUnknownGlobal = (name, parent) => {
    if (!parent) {
        return false
    }

    if (parent.type === 'MemberExpression' && parent.identifier?.name === name) {
        return true
    }

    if (
        (parent.type === 'TableKeyString' || parent.type === 'TableKey') &&
        (parent.key?.name === name || parent.key?.value === name)
    ) {
        return true
    }

    if (parent.type === 'FunctionDeclaration') {
        const identifier = parent.identifier
        return identifier?.type === 'Identifier' && identifier.name === name
    }

    return false
}

const recordReadonlyWrite = (analysis, name, position) => {
    const descriptor = getEnvironmentDescriptor(name, analysis.environment)
    if (!descriptor?.readonly) {
        return
    }

    analysis.diagnostics.push(
        createDiagnostic(
            'warning',
            `Writing to readonly runtime global '${name}'.`,
            position,
            createPosition(position.line, position.column + name.length),
            'readonly-global'
        )
    )
}

const getSyntaxDiagnostic = error => {
    const line = error.line || error.loc?.start?.line || 1
    const column = error.column ?? error.loc?.start?.column ?? 0
    const start = createPosition(line, column)
    const end = createPosition(line, column + 1)

    return createDiagnostic('error', error.message, start, end, 'syntax')
}

const createAnalysisState = (uri, version, source, environment) => ({
    uri,
    version,
    source,
    environment,
    diagnostics: [],
    symbols: [],
    tables: [],
    functions: [],
    completions: baseCompletions,
    globals: new Map(),
    rootScope: undefined,
})

const summarizeAnalysis = analysis => {
    const symbols = []
    const functions = []
    const tables = []

    const collectScopeSummary = scope => {
        if (!scope) {
            return
        }

        for (const local of scope.locals) {
            symbols.push({
                name: local.name,
                kind: local.kind,
                scope: 'local',
                line: local.declPos.line,
                column: local.declPos.column + 1,
            })
        }

        for (const child of scope.children) {
            collectScopeSummary(child)
        }
    }

    collectScopeSummary(analysis.rootScope)

    for (const [name, symbol] of analysis.globals) {
        symbols.push({
            name,
            kind: symbol.kind,
            scope: 'global',
            line: symbol.declPos.line,
            column: symbol.declPos.column + 1,
        })

        if (symbol.kind === 'function') {
            functions.push({
                name,
                scope: 'global',
                signature: symbol.signature,
            })
        }

        if (symbol.members) {
            tables.push({
                name,
                scope: 'global',
                members: Object.keys(symbol.members),
            })
        }
    }

    return {
        uri: analysis.uri,
        version: analysis.version,
        diagnostics: analysis.diagnostics,
        symbols,
        tables,
        functions,
        completions: analysis.completions,
    }
}

const walkStatements = (nodes, visit) => {
    for (const node of nodes || []) {
        visit(node)
    }
}

const inspectExpression = (analysis, node, scope, parent = null) => {
    if (!node) {
        return
    }

    if (node.type === 'Identifier') {
        if (shouldIgnoreUnknownGlobal(node.name, parent)) {
            return
        }

        const descriptor = resolveSymbolDescriptor(analysis, node.name, scope, makePosition(node.loc.start))
        if (!descriptor) {
            analysis.diagnostics.push(
                createDiagnostic(
                    'warning',
                    `Unknown global '${node.name}'.`,
                    makePosition(node.loc.start),
                    makePosition(node.loc.end),
                    'unknown-global'
                )
            )
        }
        return
    }

    if (node.type === 'MemberExpression') {
        inspectExpression(analysis, node.base, scope, node)
        const chain = memberExpressionToSegments(node)
        if (chain?.segments.length > 1) {
            const baseDescriptor = resolveDescriptorAtChain(
                analysis,
                chain.segments.slice(0, -1),
                scope,
                makePosition(node.loc.start)
            )

            addMissingMemberDiagnostic(analysis, baseDescriptor, node, makePosition(node.identifier.loc.start))
        }
        return
    }

    switch (node.type) {
        case 'TableConstructorExpression':
            for (const field of node.fields || []) {
                if (field.value) {
                    inspectExpression(analysis, field.value, scope, field)
                }
                if (field.key?.type !== 'Identifier' && field.key) {
                    inspectExpression(analysis, field.key, scope, field)
                }
            }
            return
        case 'CallExpression':
        case 'StringCallExpression':
        case 'TableCallExpression':
            inspectExpression(analysis, node.base, scope, node)
            for (const argument of node.arguments || []) {
                inspectExpression(analysis, argument, scope, node)
            }
            return
        default:
            forEachChildNode(node, child => {
                inspectExpression(analysis, child, scope, node)
            })
    }
}

const analyzeWithAst = (analysis, ast) => {
    let scopeId = 0
    const lines = analysis.source.split('\n')
    const totalLines = lines.length
    const lastLineLength = lines.at(-1)?.length || 0
    const rootScope = createScope(
        scopeId,
        createPosition(1, 0),
        createPosition(totalLines, lastLineLength),
        null,
        'root'
    )

    analysis.rootScope = rootScope

    const nodeScopes = new WeakMap()

    const enterScope = (node, currentScope, type = node.type) => {
        scopeId += 1
        const scope = createScope(
            scopeId,
            makePosition(node.loc.start),
            makePosition(node.loc.end),
            currentScope,
            type
        )

        currentScope.children.push(scope)
        nodeScopes.set(node, scope)
        return scope
    }

    const attachAssignmentTarget = (target, descriptor, scope, position) => {
        if (target.type === 'Identifier') {
            const local = collectVisibleLocals(scope, position).get(target.name)
            if (local) {
                attachDescriptorToSymbol(local, descriptor)
                return
            }

            const global = ensureUserGlobal(analysis, target.name, position)
            attachDescriptorToSymbol(global, descriptor)
            return
        }

        if (target.type !== 'MemberExpression' || target.identifier?.type !== 'Identifier') {
            return
        }

        const chain = memberExpressionToSegments(target)
        if (!chain || chain.segments.length < 2) {
            return
        }

        const rootName = chain.segments[0]
        const baseDescriptor =
            collectVisibleLocals(scope, position).get(rootName) ||
            analysis.globals.get(rootName) ||
            ensureUserGlobal(analysis, rootName, position, 'table')

        baseDescriptor.kind = baseDescriptor.kind === 'function' ? 'function' : 'table'
        baseDescriptor.members ||= {}
        const parentDescriptor = ensureNestedMembers(baseDescriptor, chain.segments.slice(1, -1))
        const leafName = chain.segments.at(-1)

        parentDescriptor.members ||= {}
        parentDescriptor.members[leafName] = mergeDescriptor(parentDescriptor.members[leafName], descriptor)
    }

    const prewalk = (node, currentScope) => {
        if (!node) {
            return
        }

        switch (node.type) {
            case 'FunctionDeclaration': {
                const signature = buildFunctionSignature(node, node.identifier?.name || 'function')
                if (node.identifier?.type === 'Identifier') {
                    if (node.isLocal) {
                        const local = declareLocal(
                            currentScope,
                            node.identifier.name,
                            'function',
                            makePosition(node.loc.start),
                            makePosition(node.loc.start),
                            { signature }
                        )
                        attachDescriptorToSymbol(local, createDescriptor('function', { signature }))
                    } else {
                        const global = ensureUserGlobal(
                            analysis,
                            node.identifier.name,
                            makePosition(node.loc.start),
                            'function'
                        )
                        attachDescriptorToSymbol(global, createDescriptor('function', { signature }))
                    }
                } else if (node.identifier?.type === 'MemberExpression') {
                    attachAssignmentTarget(
                        node.identifier,
                        createDescriptor(node.identifier.indexer === ':' ? 'method' : 'function', {
                            signature,
                        }),
                        currentScope,
                        makePosition(node.loc.start)
                    )
                }

                const functionScope = enterScope(node, currentScope, 'function')
                if (node.identifier?.type === 'MemberExpression' && node.identifier.indexer === ':') {
                    declareLocal(
                        functionScope,
                        'self',
                        'parameter',
                        makePosition(node.loc.start),
                        makePosition(node.loc.start),
                        { synthetic: true }
                    )
                }

                for (const parameter of node.parameters || []) {
                    if (parameter.type === 'Identifier') {
                        declareLocal(
                            functionScope,
                            parameter.name,
                            'parameter',
                            makePosition(parameter.loc.start),
                            makePosition(parameter.loc.start)
                        )
                    }
                }

                walkStatements(node.body, child => prewalk(child, functionScope))
                return
            }
            case 'LocalStatement':
                for (let index = 0; index < (node.variables || []).length; index += 1) {
                    const variable = node.variables[index]
                    if (variable.type !== 'Identifier') {
                        continue
                    }

                    const local = declareLocal(
                        currentScope,
                        variable.name,
                        'variable',
                        makePosition(variable.loc.start),
                        makePosition(node.loc.end)
                    )

                    attachDescriptorToSymbol(local, inferValueDescriptor(node.init?.[index], 'variable'))
                }
                break
            case 'ForNumericStatement': {
                const loopScope = enterScope(node, currentScope, 'loop')
                if (node.variable?.type === 'Identifier') {
                    declareLocal(
                        loopScope,
                        node.variable.name,
                        'variable',
                        makePosition(node.variable.loc.start),
                        makePosition(node.loc.start)
                    )
                }
                walkStatements(node.body, child => prewalk(child, loopScope))
                return
            }
            case 'ForGenericStatement': {
                const loopScope = enterScope(node, currentScope, 'loop')
                for (const variable of node.variables || []) {
                    if (variable.type === 'Identifier') {
                        declareLocal(
                            loopScope,
                            variable.name,
                            'variable',
                            makePosition(variable.loc.start),
                            makePosition(node.loc.start)
                        )
                    }
                }
                walkStatements(node.body, child => prewalk(child, loopScope))
                return
            }
            case 'AssignmentStatement':
                for (let index = 0; index < (node.variables || []).length; index += 1) {
                    attachAssignmentTarget(
                        node.variables[index],
                        inferValueDescriptor(node.init?.[index]),
                        currentScope,
                        makePosition(node.variables[index].loc.start)
                    )
                }
                break
            default:
                break
        }

        if (BLOCK_SCOPE_TYPES.has(node.type)) {
            const blockScope = enterScope(node, currentScope)
            walkStatements(node.body, child => prewalk(child, blockScope))
            if (node.clauses) {
                walkStatements(node.clauses, child => prewalk(child, blockScope))
            }
            if (node.elseBody) {
                walkStatements(node.elseBody, child => prewalk(child, blockScope))
            }
            return
        }

        forEachChildNode(node, child => prewalk(child, currentScope))
    }

    const inspectNode = (node, currentScope) => {
        if (!node) {
            return
        }

        switch (node.type) {
            case 'LocalStatement':
                for (const expression of node.init || []) {
                    inspectExpression(analysis, expression, currentScope, node)
                }
                return
            case 'AssignmentStatement':
                for (const expression of node.init || []) {
                    inspectExpression(analysis, expression, currentScope, node)
                }

                for (const variable of node.variables || []) {
                    if (variable.type === 'Identifier') {
                        const local = collectVisibleLocals(
                            currentScope,
                            makePosition(variable.loc.start)
                        ).get(variable.name)
                        if (!local) {
                            recordReadonlyWrite(analysis, variable.name, makePosition(variable.loc.start))
                        }
                    } else if (variable.type === 'MemberExpression') {
                        inspectExpression(analysis, variable.base, currentScope, variable)
                    }
                }
                return
            case 'FunctionDeclaration': {
                if (node.identifier?.type === 'Identifier' && !node.isLocal) {
                    recordReadonlyWrite(analysis, node.identifier.name, makePosition(node.identifier.loc.start))
                }

                const functionScope = nodeScopes.get(node) || currentScope
                walkStatements(node.body, child => inspectNode(child, functionScope))
                return
            }
            case 'CallStatement':
                inspectExpression(analysis, node.expression, currentScope, node)
                return
            case 'ReturnStatement':
                for (const argument of node.arguments || []) {
                    inspectExpression(analysis, argument, currentScope, node)
                }
                return
            case 'ForNumericStatement': {
                inspectExpression(analysis, node.start, currentScope, node)
                inspectExpression(analysis, node.end, currentScope, node)
                if (node.step) {
                    inspectExpression(analysis, node.step, currentScope, node)
                }
                const loopScope = nodeScopes.get(node) || currentScope
                walkStatements(node.body, child => inspectNode(child, loopScope))
                return
            }
            case 'ForGenericStatement': {
                for (const iterator of node.iterators || []) {
                    inspectExpression(analysis, iterator, currentScope, node)
                }
                const loopScope = nodeScopes.get(node) || currentScope
                walkStatements(node.body, child => inspectNode(child, loopScope))
                return
            }
            case 'WhileStatement':
                inspectExpression(analysis, node.condition, currentScope, node)
                walkStatements(node.body, child => inspectNode(child, nodeScopes.get(node) || currentScope))
                return
            case 'RepeatStatement':
                walkStatements(node.body, child => inspectNode(child, nodeScopes.get(node) || currentScope))
                inspectExpression(analysis, node.condition, nodeScopes.get(node) || currentScope, node)
                return
            case 'IfStatement':
                walkStatements(node.clauses, clause => inspectNode(clause, currentScope))
                return
            case 'IfClause':
            case 'ElseifClause':
                inspectExpression(analysis, node.condition, currentScope, node)
                walkStatements(node.body, child => inspectNode(child, nodeScopes.get(node) || currentScope))
                return
            case 'ElseClause':
                walkStatements(node.body, child => inspectNode(child, nodeScopes.get(node) || currentScope))
                return
            default:
                forEachChildNode(node, child => inspectNode(child, currentScope))
        }
    }

    walkStatements(ast.body, node => prewalk(node, rootScope))
    walkStatements(ast.body, node => inspectNode(node, rootScope))

    return analysis
}

export const analyzeLua = ({
    uri = 'memory://model.lua',
    version = 1,
    source,
    environment = LUA_ENVIRONMENT_MANIFEST,
}) => {
    const analysis = createAnalysisState(uri, version, source, environment)

    let ast
    try {
        ast = luaparse.parse(source, {
            comments: false,
            locations: true,
            ranges: true,
            scope: false,
            luaVersion: '5.3',
        })
    } catch (error) {
        analysis.diagnostics.push(getSyntaxDiagnostic(error))
        return analysis
    }

    return analyzeWithAst(analysis, ast)
}

export const getVisibleSymbols = (analysis, position) => {
    if (!analysis.rootScope) {
        return new Map()
    }

    const scope = resolveScopeAtPosition(
        analysis.rootScope,
        createPosition(position.lineNumber, position.column - 1)
    )

    return scope ? collectVisibleLocals(scope, createPosition(position.lineNumber, position.column - 1)) : new Map()
}

export const createCompletionItems = (analysis, position) => {
    const sourceText = analysis.source
    if (!analysis.rootScope) {
        const sanitizedSource = sanitizeSourceForCompletion(sourceText, position)
        if (sanitizedSource !== sourceText) {
            analysis = analyzeLua({
                uri: analysis.uri,
                version: analysis.version,
                source: sanitizedSource,
                environment: analysis.environment,
            })
        }
    }

    const cursor = createPosition(position.lineNumber, position.column - 1)
    const scope = analysis.rootScope ? resolveScopeAtPosition(analysis.rootScope, cursor) : undefined
    const offset = getOffsetAtPosition(sourceText, position)
    const textBeforeCursor = sourceText.slice(0, offset)
    const linePrefix = textBeforeCursor.split('\n').at(-1) || ''

    if (/--.*$/.test(linePrefix)) {
        return []
    }

    const quoteCount =
        (linePrefix.match(/(?<!\\)"/g) || []).length + (linePrefix.match(/(?<!\\)'/g) || []).length
    if (quoteCount % 2 === 1) {
        return []
    }

    const accessMatch = linePrefix.match(/([A-Za-z_][\w]*(?:[.:][A-Za-z_][\w]*)*)([.:])$/)
    const suggestions = new Map()

    const pushSuggestion = suggestion => {
        const existing = suggestions.get(suggestion.label)
        if (!existing || suggestion.sortText < existing.sortText) {
            suggestions.set(suggestion.label, suggestion)
        }
    }

    const pushSymbolSuggestion = (name, symbol, priority) => {
        if (!symbol) {
            return
        }

        pushSuggestion({
            label: name,
            kind: symbol.kind === 'parameter' ? 'variable' : symbol.kind,
            insertText: name,
            detail: symbol.signature || symbol.documentation || symbol.kind,
            documentation: symbol.documentation,
            sortText: `${priority}-${name}`,
        })
    }

    if (accessMatch && scope) {
        const chain = accessMatch[1].split(/[.:]/)
        const accessor = accessMatch[2]
        const descriptor = resolveDescriptorAtChain(analysis, chain, scope, cursor)
        if (descriptor?.members) {
            for (const [name, member] of Object.entries(descriptor.members)) {
                if (accessor === ':' && !functionLikeKinds.has(member.kind)) {
                    continue
                }

                pushSuggestion({
                    label: name,
                    kind: member.kind,
                    insertText: name,
                    detail: member.signature || member.documentation || member.kind,
                    documentation: member.documentation,
                    sortText: `1-${name}`,
                })
            }
        }

        return [...suggestions.values()]
    }

    if (scope) {
        const locals = collectVisibleLocals(scope, cursor)
        for (const [name, symbol] of locals) {
            pushSymbolSuggestion(name, symbol, 1)
        }
    }

    for (const [name, symbol] of analysis.globals) {
        pushSymbolSuggestion(name, symbol, 2)
    }

    for (const [name] of Object.entries(analysis.environment.globals)) {
        pushSymbolSuggestion(name, getEnvironmentDescriptor(name, analysis.environment), 3)
    }

    for (const item of baseCompletions) {
        pushSuggestion(item)
    }

    return [...suggestions.values()]
}

export const summarizeLuaAnalysis = analysis => summarizeAnalysis(analysis)
