[![Build Status](https://travis-ci.org/appium/node-adb-client.svg)](https://travis-ci.org/appium/node-adb-client)

# node-adb-client
A direct-to-device ADB client implementation in Node.

# Protocol Documentation
Documentation for the ADB protocol can be found [here](https://github.com/cstyan/adbDocumentation).

# Installation.
node-adb-client relies on the npm module [usb](https://www.npmjs.com/package/usb),
please follow it's installation instructions to get the required libraries for your
platform before running `npm install`.

After `npm install`, please run `node-gyp configure build` to build libmincrypt.

# ADB Keys
This library assumes the location of your ADB public and private key will be 
`$HOME/.android/`. Please ensure your keys are in this folder, or modify the values 
under `ADB_KEY` in `lib/constants.js`.

