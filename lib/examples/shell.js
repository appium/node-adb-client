// transpile:main
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import { getSerialNumbers } from '../helpers';

async function start () {
  let availableDevices = ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    await getSerialNumbers(availableDevices);
    // just select the first device
    let device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
    await device.connect();
    console.log("connected");
    let command = {
      type:   "shell"
    , string: "ls"
    };
    await device.runCommand(command);
    await device.closeConnection();
    console.log("closed");
  }
}

console.log("Starting.");
asyncify(start);