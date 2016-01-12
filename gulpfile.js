"use strict";

var gulp = require('gulp'),
    fs = require('fs'),
    boilerplate = require('appium-gulp-plugins').boilerplate.use(gulp);

gulp.task('node-gyp', function () {
  // exec is async, so maybe the unit tests are starting and erroring out
  // before the node-gyp build finishes?
  return exec('node-gyp configure build').then(function () {
    fs.statSync('./build/Release/binding.node');
  });
});

boilerplate({build: 'node-adb-client', jscs: false, postTranspile: ['node-gyp']});
