const path = require('path');

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  const isDevMode = mode === 'development';

  return {
    mode,
    entry: {
      index: './example/src/index.js',
      modeler: './example/src/modeler.js'
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'example/dist'),
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.bpmn$/,
          type: 'asset/source'
        },
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [ '@babel/preset-env' ]
            }
          }
        },
        {
          test: /\.json$/,
          type: 'json',
          parser: {
            parse: JSON.parse
          }
        },
        {
          test: /\.css$/,
          use: [ 'style-loader', 'css-loader' ]
        },
        {
          test: /\.svg$/,
          use: 'raw-loader'
        }
      ]
    },
    devtool: isDevMode ? 'eval-source-map' : 'source-map',
    devServer: {
      static: path.join(__dirname, 'example'),
      devMiddleware: { publicPath: '/dist/' },
      compress: true,
      port: 9000,
      hot: true,
      open: true,
      liveReload: false
    }
  };
};
