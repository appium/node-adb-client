[![Build Status](https://travis-ci.org/appium/node-adb-client.svg)](https://travis-ci.org/appium/node-adb-client)
[![Coverage Status](https://coveralls.io/repos/github/appium/node-adb-client/badge.svg?branch=master)](https://coveralls.io/github/appium/node-adb-client?branch=master)

# node-adb-client
A direct-to-device ADB client implementation in Node.

# Protocol Documentation
Documentation for the ADB protocol can be found [here](https://github.com/cstyan/adbDocumentation).

# Installation.
node-adb-client relies on the npm module [usb](https://www.npmjs.com/package/usb),
please follow it's installation instructions to get the required libraries for your
platform before running `npm install`.

After `npm install`, please run `node-gyp configure build` to build libmincrypt.
