// transpile:main
import { connectToDevice } from '../../index.js';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import { findAdbDevices, getSerialNumbers } from '../helpers';

async function start () {
  let availableDevices = findAdbDevices();
  await getSerialNumbers(availableDevices);
  // just select the first device
  let adb = connectToDevice(CONNECTION_TYPES.USB, availableDevices[0]);
  await adb.start();
  console.log("Device started.");
  // opening a stream into the device causes issues atm
  let command = {
    type:   "push"
  , source: "/Users/callumstyan/test.py"
  , destination: "sdcard/"
  };
  await adb.open(command);
  console.log("shell opened");
  console.log("closing device!");
  await adb.closeConnection();
}

console.log("Starting!");
asyncify(start);
