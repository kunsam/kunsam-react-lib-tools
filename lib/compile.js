'use strict';
const { getProjectPath, injectRequire } = require('./utils/projectHelper'); // eslin
injectRequire();


const gulp = require('gulp');
const merge2 = require('merge2');
const rimraf = require('rimraf');
const esDir = getProjectPath('es');
const babel = require('gulp-babel');
const through2 = require('through2');
const libDir = getProjectPath('lib');
const ts = require('gulp-typescript');
const replaceLib = require('./replaceLib');
const stripCode = require('gulp-strip-code');
const transformLess = require('./transformLess');
const tsConfig = require('./getTSCommonConfig')();
const { cssInjection } = require('./utils/styleUtil');
const tsDefaultReporter = ts.reporter.defaultReporter();
const getBabelCommonConfig = require('./getBabelCommonConfig');

function check() {
  if (error && !argv['ignore-error']) {
    process.exit(1);
  }
}

function compileLess(src, dest) {
  // 'src/components/**/*.less'
  const less = gulp
    .src(src)
    .pipe(
      through2.obj(function (file, encoding, next) {
        this.push(file.clone());
        if (file.path.match(/(\/|\\)style(\/|\\)index\.less$/)) {
          transformLess(file.path)
            .then(css => {
              file.contents = Buffer.from(css);
              file.path = file.path.replace(/\.less$/, '.css');
              this.push(file);
              next();
            })
            .catch(e => {
              console.error(e);
            });
        } else {
          next();
        }
      })
    )
    .pipe(gulp.dest(dest));
    // compDestination
  return less;
}

function compileAsset(src, dest) {
  // compDestination
  return gulp.src(src).pipe(gulp.dest(dest));
}

function resolveSrc() {

}

function babelify(js, modules, anotherDest) {
  const babelConfig = getBabelCommonConfig(modules);
  delete babelConfig.cacheDirectory;
  if (modules === false) {
    babelConfig.plugins.push(replaceLib);
  } else {
    babelConfig.plugins.push(require.resolve('babel-plugin-add-module-exports'));
  }
  let stream = js.pipe(babel(babelConfig)).pipe(
    through2.obj(function z(file, encoding, next) {
      this.push(file.clone());
      if (file.path.match(/(\/|\\)style(\/|\\)index\.js/)) {
        const content = file.contents.toString(encoding);
        if (content.indexOf("'react-native'") !== -1) {
          // actually in antd-mobile@2.0, this case will never run,
          // since we both split style/index.mative.js style/index.js
          // but let us keep this check at here
          // in case some of our developer made a file name mistake ==
          next();
          return;
        }
        file.contents = Buffer.from(cssInjection(content));
        file.path = file.path.replace(/index\.js/, 'css.js');
        this.push(file);
        next();
      } else {
        next();
      }
    })
  );
  if (modules === false) {
    stream = stream.pipe(
      stripCode({
        start_comment: '@remove-on-es-build-begin',
        end_comment: '@remove-on-es-build-end',
      })
    );
  }
  const destination = anotherDest || (modules === false ? esDir : libDir);
  return stream.pipe(gulp.dest(destination));
}

module.exports = function compile(modules) { 

  const destination = (modules !== false ? libDir : esDir);
  const compDestination = destination + '/components';
  rimraf.sync(destination);

  const less = compileLess(['src/components/**/*.less'], compDestination);
  const assets = compileAsset(['src/components/**/*.@(png|svg)'], compDestination);

  const thirdjs = gulp.src('src/third-js/*.js').pipe(gulp.dest(destination + '/third-js'));

  let error = 0;
  const source = ['src/components/**/*.tsx', 'src/components/**/*.ts', 'src/typings/**/*.d.ts'];
  // allow jsx file in src/components/xxx/
  if (tsConfig.allowJs) {
    source.unshift('src/components/**/*.jsx');
  }

  function check() {
    if (error && !argv['ignore-error']) {
      process.exit(1);
    }
  }

  const tsResult = gulp.src(source).pipe(
    ts(Object.assign(tsConfig, { outDir: './ts' }), {
      error(e) {
        tsDefaultReporter.error(e);
        error = 1;
      },
      finish: tsDefaultReporter.finish,
    })
  );
  tsResult.on('finish', check);
  tsResult.on('end', check);
  const tsFilesStream = babelify(tsResult.js, modules, compDestination);
  const tsd = tsResult.dts.pipe(gulp.dest(compDestination));
  return merge2([less, tsFilesStream, tsd, assets, thirdjs]);
}