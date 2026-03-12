const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'app.js',
        clean: true,
    },
    resolve: {
        fallback: {
            path: false,
            fs: false,
            child_process: false,
            crypto: false,
            url: false,
            module: false
        }
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(woff2|ttf|wasm)$/,
                type: 'asset/resource',
            },
            {
                test: /\.lua$/,
                type: 'asset/source'
            }
        ]
    },
    plugins: [
        new MonacoWebpackPlugin({
            languages: ['lua'],
            features: [
                '!codeAction',
                '!codelens',
                '!colorPicker',
                '!diffEditor',
                '!diffEditorBreadcrumbs',
                '!documentSymbols',
                '!dropOrPasteInto',
                '!floatingMenu',
                '!gotoError',
                '!gotoSymbol',
                '!inPlaceReplace',
                '!inlayHints',
                '!inlineCompletions',
                '!inspectTokens',
                '!quickCommand',
                '!quickHelp',
                '!quickOutline',
                '!referenceSearch',
                '!rename',
                '!sectionHeaders',
                '!semanticTokens',
                '!smartSelect',
                '!stickyScroll',
                '!unicodeHighlighter',
                '!wordHighlighter',
            ],
        }),
        new HtmlWebpackPlugin({
            template: 'src/index.html'
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/assets', to: 'assets' },
            ],
        }),
    ],
    experiments: {
        asyncWebAssembly: true,
        css: false,
        futureDefaults: true,
    }
};

module.exports = config;
