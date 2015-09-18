// transpile:main
import { connectToDevice } from '../../index.js';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import { findAdbDevices, getSerialNumbers, selectBySerialNumber } from '../helpers';

async function start () {
  let serialNumber = "27b1b2ef";
  let availableDevices = findAdbDevices();
  await getSerialNumbers(availableDevices);
  // get a device by serial number
  let foundDevice = selectBySerialNumber(availableDevices, serialNumber);
  let adb = connectToDevice(CONNECTION_TYPES.USB, foundDevice);
  console.log("adb: ", adb);
  await adb.initConnection();
  console.log("Device started.");
  // opening a stream into the device causes issues atm
  let command = {
    type:   "shell"
  , string: "ls"
  };
  await adb.open(command);
  console.log("shell opened");
  console.log("closing device!");
  await adb.closeConnection();
}

console.log("Starting.");
asyncify(start);
