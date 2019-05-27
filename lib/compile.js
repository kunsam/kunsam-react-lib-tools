'use strict';

const stripCode = require('gulp-strip-code');
const { getProjectPath, injectRequire } = require('./utils/projectHelper');

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
const transformLess = require('./transformLess');
const tsConfig = require('./getTSCommonConfig')();
const { cssInjection } = require('./utils/styleUtil');
const tsDefaultReporter = ts.reporter.defaultReporter();
const getBabelCommonConfig = require('./getBabelCommonConfig');

function compileLess(src, dest) {
  if (!src || !src.length) return;
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
  if (!src.length) return;
  return gulp.src(src).pipe(gulp.dest(dest));
}

function resolveSrc() { }

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

const srcObject = {
  less: [],
  asset: [],
  thirdjs: [],
  source: [],
};

// let

module.exports = function compile(modules, srcObject, dirName, onFinish) {
  const destination = modules !== false ? libDir : esDir;
  let compDestination = destination + '/src' + dirName // '/components';

  if (!srcObject) {
    rimraf.sync(compDestination);
  }

  const mksureSrcObject = srcObject && {
    less: srcObject.less || [],
    asset: srcObject.asset || [],
    thirdjs: srcObject.thirdjs || [],
    source: srcObject.source || [],
  };

  const sourceObject = mksureSrcObject || {
    thirdjs: ['src/third-js/*.js'],
    less: [
      `src/${dirName}/**/*.less`,
    ],
    asset: [
      `src/${dirName}/**/*.@(png|svg)`
    ],
    source: [
      // `src/${dirName}/**/*.tsx`,
      // `src/${dirName}/**/*.ts`,
      'src/typings/**/*.d.ts'
    ],
  };

  let mergeResult = [];
  if (sourceObject.less.length) {
    const less = compileLess(sourceObject.less, compDestination);
    mergeResult.push(less);
  }

  if (sourceObject.asset.length) {
    const assets = compileAsset(sourceObject.asset, compDestination);
    mergeResult.push(assets);
  }
  if (sourceObject.thirdjs.length) {
    const thirdjs = gulp.src(sourceObject.thirdjs).pipe(gulp.dest(destination + '/third-js'));
    mergeResult.push(thirdjs);
  }

  if (sourceObject.source.length) {
    let error = 0;
    const source = sourceObject.source;
    // allow jsx file in src/components/xxx/
    if (tsConfig.allowJs) {
      source.unshift(`src/${dirName}/**/*.jsx`);
    }
    function check() {
      if (error && !argv['ignore-error']) {
        process.exit(1);
      }
    }

    let tsConfgObject = tsConfig;
    // forSingle file compile
    if (source.length === 1) {
      const pathSplited = source[0].split('/')
      pathSplited.shift();
      pathSplited.pop();
      compDestination = `${destination}/${pathSplited.join('/')}`
      tsConfgObject = Object.assign(tsConfgObject, {
        noImplicitAny: false,
        isolatedModules: true
      });
    }

    const tsResult = gulp
      .src(source)
      // .src(['src/components/**/*.tsx', 'src/components/**/*.ts', 'src/typings/**/*.d.ts'])
      .pipe(
        ts(tsConfgObject, {
          error(e) {
            tsDefaultReporter.error(e);
            error = 1;
          },
          finish: tsDefaultReporter.finish,
        })

      );
    tsResult.on('finish', () => {
      console.log(`[kunsam-tools-compile]: ts compile finish`);
      check();
      if (onFinish) {
        onFinish();
      }
    });
    tsResult.on('end', () => {
      console.log(`[kunsam-tools-compile]: ts compile end`);
      check();
    });
    const tsFilesStream = babelify(tsResult.js, modules, compDestination);
    mergeResult.push(tsFilesStream);
    const tsdeclaration = tsResult.dts.pipe(gulp.dest(compDestination));
    mergeResult.push(tsdeclaration);
  }
  return merge2(mergeResult);
};
