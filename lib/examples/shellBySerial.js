// transpile:main
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import { selectBySerialNumber } from '../../lib/helpers';

async function start () {
  let availableDevices = await ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    // select device by serial number: 4d00a90c4f041119
    let serial = "4d00a90c4f041119";
    let selectedDevice = selectBySerialNumber(availableDevices, serial);
    let device = new ADB(CONNECTION_TYPES.USB, selectedDevice);
    await device.connect();
    console.log("connected");
    let command = {
      type:   "shell"
    , string: "getprop ro.build.version.sdk"
    };
    await device.runCommand(command);
    await device.closeConnection();
    console.log("closed");
  }
}

console.log("Starting.");
asyncify(start);