const { getProjectPath, injectRequire, getConfig } = require('./utils/projectHelper'); // eslint-disable-line import/order

injectRequire();

const fs = require('fs');
const gulp = require('gulp');
const path = require('path');
const chalk = require('chalk');
const rimraf = require('rimraf');
const getNpm = require('./getNpm');
const runCmd = require('./runCmd');
const webpack = require('webpack');
const watch = require('gulp-watch');
const through2 = require('through2');
const install = require('./install');
const ts = require('gulp-typescript');
const { execSync } = require('child_process');
const checkDeps = require('./lint/checkDeps');
const checkDiff = require('./lint/checkDiff');
const selfPackage = require('../package.json');
const tsConfig = require('./getTSCommonConfig')();
const getNpmArgs = require('./utils/get-npm-args');
const argv = require('minimist')(process.argv.slice(2));
const packageJson = require(getProjectPath('package.json'));

const compile = require('./compile')
const cwd = process.cwd();


function dist(done) {
  rimraf.sync(getProjectPath('dist'));
  process.env.RUN_ENV = 'PRODUCTION';
  const webpackConfig = require(getProjectPath('webpack.config.js'));
  webpack(webpackConfig, (err, stats) => {
    if (err) {
      console.error(err.stack || err);
      if (err.details) {
        console.error(err.details);
      }
      return;
    }

    const info = stats.toJson();

    if (stats.hasErrors()) {
      console.error(info.errors);
    }

    if (stats.hasWarnings()) {
      console.warn(info.warnings);
    }

    const buildInfo = stats.toString({
      hash: false,
      colors: true,
      chunks: false,
      children: true,
      modules: false,
      version: false,
      chunkModules: false,
    });
    console.log(buildInfo);

    // Additional process of dist finalize
    const { dist: { finalize } = {} } = getConfig();
    if (finalize) {
      console.log('[Dist] Finalization...');
      finalize();
    }

    done(0);
  });
}

function tag() {
  console.log('tagging');
  const { version } = packageJson;
  execSync(`git tag ${version}`);
  execSync(`git push origin ${version}:${version}`);
  execSync('git push origin master:master');
  console.log('tagged');
}

gulp.task(
  'check-git',
  gulp.series(done => {
    runCmd('git', ['status', '--porcelain'], (code, result) => {
      if (/^\?\?/m.test(result)) {
        return done(`There are untracked files in the working tree.\n${result}
      `);
      }
      if (/^([ADRM]| [ADRM])/m.test(result)) {
        return done(`There are uncommitted changes in the working tree.\n${result}
      `);
      }
      return done();
    });
  })
);

gulp.task('clean', () => {
  rimraf.sync(getProjectPath('_site'));
  rimraf.sync(getProjectPath('_data'));
});

gulp.task(
  'dist',
  gulp.series(done => {
    dist(done);
  })
);

gulp.task(
  'deps-lint',
  gulp.series(done => {
    checkDeps(done);
  })
);

gulp.task(
  'ts-lint',
  gulp.series(done => {
    const tslintBin = require.resolve('tslint/bin/tslint');
    const tslintConfig = path.join(__dirname, './tslint.json');
    const args = [tslintBin, '-c', tslintConfig, 'src/components/**/*.tsx'];
    runCmd('node', args, done);
  })
);

gulp.task(
  'ts-lint-fix',
  gulp.series(done => {
    const tslintBin = require.resolve('tslint/bin/tslint');
    const tslintConfig = path.join(__dirname, './tslint.json');
    const args = [tslintBin, '-c', tslintConfig, 'src/components/**/*.tsx', '--fix'];
    runCmd('node', args, done);
  })
);

const tsFiles = ['**/*.ts', '**/*.tsx', '!node_modules/**/*.*', 'typings/**/*.d.ts'];

function compileTs(stream) {
  return stream
    .pipe(ts(tsConfig))
    .js.pipe(
      through2.obj(function(file, encoding, next) {
        file.path = file.path.replace(/\.[jt]sx$/, '.js');
        this.push(file);
        next();
      })
    )
    .pipe(gulp.dest(process.cwd()));
}

gulp.task('tsc', () =>
  compileTs(
    gulp.src(tsFiles, {
      base: cwd,
    })
  )
);

gulp.task(
  'watch-tsc',
  gulp.series('tsc', () => {
    watch(tsFiles, f => {
      if (f.event === 'unlink') {
        const fileToDelete = f.path.replace(/\.tsx?$/, '.js');
        if (fs.existsSync(fileToDelete)) {
          fs.unlinkSync(fileToDelete);
        }
        return;
      }
      const myPath = path.relative(cwd, f.path);
      compileTs(
        gulp.src([myPath, 'typings/**/*.d.ts'], {
          base: cwd,
        })
      );
    });
  })
);


function publish(tagString, done) {
  let args = ['publish', '--with-kunsam-tools', '--access=public'];
  if (tagString) {
    args = args.concat(['--tag', tagString]);
  }
  const publishNpm = process.env.PUBLISH_NPM_CLI || 'npm';
  runCmd(publishNpm, args, code => {
    console.log('Publish return code:', code);
    if (!argv['skip-tag'] && !code) {
      tag();
    }
    done(code);
  });
}

// We use https://unpkg.com/[name]/?meta to check exist files
gulp.task(
  'package-diff',
  gulp.series(done => {
    checkDiff(packageJson.name, done);
  })
);

function pub(done) {
  const notOk = !packageJson.version.match(/^\d+\.\d+\.\d+$/);
  let tagString;
  if (argv['npm-tag']) {
    tagString = argv['npm-tag'];
  }
  if (!tagString && notOk) {
    tagString = 'next';
  }
  if (packageJson.scripts['pre-publish']) {
    runCmd('npm', ['run', 'pre-publish'], code2 => {
      if (code2) {
        done(code2);
        return;
      }
      publish(tagString, done);
    });
  } else {
    publish(tagString, done);
  }
}

gulp.task('compile-with-es', done => {
  done(); // temp shut down
  // console.log('[Parallel] Compile to es...');
  // compile(false).on('finish', done);
});

gulp.task('compile-with-lib', done => {
  console.log('[Parallel] Compile to js...');
  compile().on('finish', done);
});

gulp.task(
  'watch-compile-with-lib',
  () => {
    watch(['src/**/*.*'], f => {
      if (f.event === 'unlink') {
        const fileToDelete = f.path.replace(/\.tsx?$/, '.js');
        if (fs.existsSync(fileToDelete)) {
          fs.unlinkSync(fileToDelete);
        }
        return;
      }
      const myPath = path.relative(cwd, f.path);
      const srcObejct = {}
      if (myPath.match(/.less$/)) {
        srcObejct.less = [myPath]
      }
      if (myPath.match(/.(ts|tsx)$/)) {
        const fileToDelete = f.path.replace(/\.tsx?$/, '.js');
        if (fs.existsSync(fileToDelete)) {
          fs.unlinkSync(fileToDelete);
        }
        srcObejct.source = [myPath]
      }
      if (myPath.match(/third-js\/[\s\S].js$/)) {
        srcObejct.thirdjs = [myPath]
      }
      if (myPath.match(/.(png|svg)$/)) {
        srcObejct.asset = [myPath]
      }
      console.log(`[kunsam-tools-watch]: ${myPath} ${f.event}`)
      function onEnd() {
        const target = packageJson['kunsam-tools-lib-target'];
        if (target) {
          runCmd('cp', ['-R', './lib ./dist', `${target}/node_modules/gm-web-excel-table`], _ => {
            console.log('lib-target updated')
          });
        }
      }
      compile(undefined, srcObejct, onEnd);
    })
  }
);

gulp.task('compile-finalize', done => {
  // Additional process of compile finalize
  const { compile: { finalize } = {} } = getConfig();
  if (finalize) {
    console.log('[Compile] Finalization...');
    finalize();
  }
  done();
});

gulp.task(
  'compile',
  gulp.series(gulp.parallel('compile-with-es', 'compile-with-lib'), 'compile-finalize')
);

gulp.task(
  'install',
  gulp.series(done => {
    install(done);
  })
);

gulp.task(
  'pub',
  gulp.series('check-git', 'compile', 'dist', 'package-diff', done => {
    pub(done);
  })
);

gulp.task(
  'update-self',
  gulp.series(done => {
    getNpm(npm => {
      console.log(`${npm} updating ${selfPackage.name}`);
      runCmd(npm, ['update', selfPackage.name], c => {
        console.log(`${npm} update ${selfPackage.name} end`);
        done(c);
      });
    });
  })
);

function reportError() {
  console.log(chalk.bgRed('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'));
  console.log(chalk.bgRed('!! `npm publish` is forbidden for this package. !!'));
  console.log(chalk.bgRed('!! Use `npm run pub` instead.        !!'));
  console.log(chalk.bgRed('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'));
}

gulp.task(
  'guard',
  gulp.series(done => {
    const npmArgs = getNpmArgs();
    if (npmArgs) {
      for (let arg = npmArgs.shift(); arg; arg = npmArgs.shift()) {
        if (/^pu(b(l(i(sh?)?)?)?)?$/.test(arg) && npmArgs.indexOf('--with-kunsam-tools') < 0) {
          reportError();
          done(1);
          return;
        }
      }
    }
    done();
  })
);
