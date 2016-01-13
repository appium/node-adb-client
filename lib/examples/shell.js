// transpile:main
// import { connectToDevice } from '../../index.js';
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
// import { findAdbDevices, getSerialNumbers } from '../helpers';

async function start () {
  let availableDevices = ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    // await ADB.getSerialNumbers(availableDevices);
    // just select the first device
    let connection = new ADB();
    connection.selectDevice(CONNECTION_TYPES.USB, availableDevices[0]);
    // await adb.initConnection();
    connection.start();
    console.log("Device started.");
    // opening a stream into the device causes issues atm
    // let command = {
    //   type:   "shell"
    // , string: "ls"
    // };
    // await adb.open(command);
    console.log("shell opened");
    console.log("closing device!");
    // await adb.closeConnection();
  } else {
    console.log("no devices found");
  }
}

console.log("Starting.");
asyncify(start);
