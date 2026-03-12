export const shouldApplyResponse = (expectedVersion, responseVersion) =>
    typeof expectedVersion === 'number' && expectedVersion === responseVersion

export const mergeDiagnostics = (...groups) => {
    const seen = new Set()
    const merged = []

    for (const group of groups) {
        for (const diagnostic of group || []) {
            const key = [
                diagnostic.severity,
                diagnostic.message,
                diagnostic.startLineNumber,
                diagnostic.startColumn,
                diagnostic.endLineNumber,
                diagnostic.endColumn,
            ].join(':')

            if (seen.has(key)) {
                continue
            }

            seen.add(key)
            merged.push(diagnostic)
        }
    }

    return merged
}

export const mergeSyntaxDiagnostics = (analysisDiagnostics = [], runtimeDiagnostics = []) => {
    const syntaxDiagnostics = analysisDiagnostics.filter(diagnostic => diagnostic.code === 'syntax')
    const nonSyntaxDiagnostics = analysisDiagnostics.filter(diagnostic => diagnostic.code !== 'syntax')

    if (!runtimeDiagnostics.length) {
        return mergeDiagnostics(analysisDiagnostics)
    }

    if (!syntaxDiagnostics.length) {
        return mergeDiagnostics(nonSyntaxDiagnostics, runtimeDiagnostics)
    }

    const [runtimeDiagnostic] = runtimeDiagnostics
    const mappedSyntaxDiagnostics = syntaxDiagnostics.map((diagnostic, index) =>
        index === 0
            ? {
                ...diagnostic,
                code: runtimeDiagnostic.code,
                message: runtimeDiagnostic.message,
                severity: runtimeDiagnostic.severity,
            }
            : diagnostic
    )

    return mergeDiagnostics(nonSyntaxDiagnostics, mappedSyntaxDiagnostics)
}
