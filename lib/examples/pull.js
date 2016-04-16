// transpile:main
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';

async function start () {
  let availableDevices = ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    // just select the first device
    let device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
    await device.connect();
    console.log("connected");
    let command = {
      type:        "pull"
    , source:      "sdcard/test.py"
    , destination: "/Users/callumstyan/test.py"
    };
    await device.runCommand(command);
    await device.closeConnection();
    console.log("closed");
  }
}

console.log("Starting!");
asyncify(start);