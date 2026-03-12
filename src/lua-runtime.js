import { decorateFunction } from 'wasmoon'

export const registerRuntimeHelpers = (state, handlers = {}) => {
    const { onLog = () => {}, onClear = () => {} } = handlers

    state.global.set('print', decorateFunction((thread, argsQuantity) => {
        const values = []
        for (let i = 1; i <= argsQuantity; i++) {
            values.push(thread.indexToString(i))
        }

        onLog(values)
    }, {
        receiveArgsQuantity: true,
        receiveThread: true,
    }))

    state.global.set('clear', () => {
        onClear()
    })
}

