// transpile:main
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import path from 'path';

async function start () {
  let availableDevices = await ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    let device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
    await device.connect();
    console.log("connected");
    let apkSource = path.resolve(__dirname
                              , ".."
                              , ".."
                              , ".."
                              , "test"
                              , "fixtures"
                              , "contactManager.apk");
    let command = {
      type: "install"
    , source: apkSource
    };
    await device.runCommand(command);
    await device.closeConnection();
    console.log("closed");
  }
}

console.log("Starting!");
asyncify(start);