import { analyzeLua, createCompletionItems, summarizeLuaAnalysis } from './lua-analysis-core'
import { validateLuaSource } from './lua-validate'

const analysisCache = new Map()

const ensureAnalysis = request => {
    const cached = analysisCache.get(request.uri)
    if (cached && cached.version === request.version) {
        return cached.analysis
    }

    const analysis = analyzeLua(request)
    analysisCache.set(request.uri, {
        version: request.version,
        analysis,
    })

    return analysis
}

self.onmessage = async ({ data }) => {
    const { type, request, id } = data

    if (type === 'analyze') {
        const analysis = ensureAnalysis(request)
        self.postMessage({
            type: 'analyzeResult',
            id,
            response: summarizeLuaAnalysis(analysis),
        })
        return
    }

    if (type === 'complete') {
        const analysis = ensureAnalysis(request)
        self.postMessage({
            type: 'completeResult',
            id,
            response: {
                uri: request.uri,
                version: request.version,
                suggestions: createCompletionItems(analysis, request.position),
            },
        })
        return
    }

    if (type === 'validate') {
        const response = await validateLuaSource(request.source, { version: request.version })
        self.postMessage({
            type: 'validateResult',
            id,
            response,
        })
    }
}
