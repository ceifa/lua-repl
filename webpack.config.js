const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin')
const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'app.js'
    },
    resolve: {
        fallback: {
            path: false,
            fs: false,
            child_process: false,
            crypto: false,
            url: false
        }
    },
    module: {
        defaultRules: [
            {
                type: "javascript/auto",
                resolve: {}
            }
        ],
        rules: [{
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
        }, {
            type: "javascript/auto",
            test: /\.(ttf|wasm|woff|woff2)$/,
            use: ['file-loader']
        }, {
            test: /\.lua$/,
            use: ['raw-loader']
        }]
    },
    plugins: [
        new MonacoWebpackPlugin({
            languages: ['lua']
        }),
        new HtmlWebpackPlugin({
            template: 'src/index.html'
        })
    ],
    experiments: {
        asyncWebAssembly: true,
        syncWebAssembly: true
    }
};