// transpile:main
import { connectToDevice } from '../../index';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';
import { findAdbDevices } from '../helpers';

async function start () {
  let availableDevices = findAdbDevices();
  // just select the first device
  let adb = connectToDevice(CONNECTION_TYPES.USB, availableDevices[0]);
  await adb.start();
  console.log("device started");
  let command = {
    type: "reboot"
  };
  console.log("calling open");
  await adb.open(command);
  console.log("device should reboot now");
}

console.log("starting");
asyncify(start);