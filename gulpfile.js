"use strict";

var gulp = require('gulp'),
  Promise = require('bluebird').Promise,
  exec = Promise.promisify(require('child_process').exec),
  boilerplate = require('appium-gulp-plugins').boilerplate.use(gulp);

gulp.task('node-gyp', function () {
  return exec('node-gyp configure build');
});
boilerplate({build: 'node-adb-client', jscs: false, postTranspile: ['node-gyp']});
