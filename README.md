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

# Examples
For example usage of each implemented command type see the `lib/examples` folder,
or the tests.

# Public Functions
These are the functions you should be interacting with when using this library.

## Static Functions
Including the library (ADB class) will get you access to the static function 
findAdbDevices. This function will return an array of ADB compatible devices, 
including the devices serial number.  
    let availableDevices = await ADB.findAdbDevices();
    if (availableDevices.length > 0) {
        // just select the first device
        let device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);

You can also use the selectBySerial function from lib/helpers to search through 
available ADB devices and find the device with a given serial number. For example:  
    // select device by serial number: 4d00a90c4f041119
    let serial = "4d00a90c4f041119";
    let selectedDevice = selectBySerialNumber(availableDevices, serial);

## Member Functions
After creating a new ADB instance from a device you gain access to a few functions
that allow you to interact with the device.

### Connect
Connect takes care of the ADB connection handshake, after which your device is in
a state where you can run any normal ADB command on that device. The connect function
assumes your ADB keys are in `~/.android/` with the names `adbkey` and `adbkey.pub`.
If you've never used ADB before, it's likely that the device will not recognize 
your private key, meaning your public key will be sent to the device. If this is 
the case, a dialog will show on the devices screen asking you if you want to accept
that public key. Checking the save key checkbox will allow you to skip this step
in the future, and your public key will be accepted for authentication with the
device.  
`await device.connect();`  

### Run Command
The Run Command function takes in a command object, with the command type and 
parameters required for that command, and sends them to the device (ADB daemon).
Any results of that command are returned to the client. Available command types
are:  

#### Shell
Run a shell command on the device.  
    let command = {
        type:   "shell"
      , string: "ls /sdcard"
      , print: false
    };
By default all shell command output is printed to the console, you can use 
`print: false` to block this.

#### Push
Push a file to the device.  
    let command = {
      type:        "push"
    , source:      "path/to/some/file"
    , destination: "sdcard/"
    };

#### Pull
Pull a file from the device.  
    let command = {
      type:        "push"
    , source:      "sdcard/some/file"
    , destination: "~/Desktop/file"
    };

#### Install
Install an apk on the deivce.  
    let command = {
      type: "install"
    , source: "path/to/app.apk"
    };

#### Uninstall
Uninstall an apk.  
    let command = {
      type: "uninstall"
    , packageName: "com.example.android.contactmanager"
    };

#### Reboot
Reboot the device. Note that the promise for this function resolves when the reboot
executes, it does not wait for the device to fully boot up before resolving.  
    let command = {
      type:   "reboot"
    };