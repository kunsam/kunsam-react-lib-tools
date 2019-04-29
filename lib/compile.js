const gulp = require('gulp');
const merge2 = require('merge2');
const rimraf = require('rimraf');
const through2 = require('through2');
const transformLess = require('./transformLess');
const tsDefaultReporter = ts.reporter.defaultReporter();

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



module.exports = function compile(modules) {
  const destination = (modules !== false ? libDir : esDir);
  const compDestination = destination + '/components';
  rimraf.sync(destination);

  const less = compileLess(['src/components/**/*.less']);
  const assets = compileAsset(['src/components/**/*.@(png|svg)']);

  const thirdjs = gulp.src('src/third-js/*.js').pipe(gulp.dest(destination + '/third-js'));

  let error = 0;
  const source = ['src/components/**/*.tsx', 'src/components/**/*.ts', 'src/typings/**/*.d.ts'];
  // allow jsx file in src/components/xxx/
  if (tsConfig.allowJs) {
    source.unshift('src/components/**/*.jsx');
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