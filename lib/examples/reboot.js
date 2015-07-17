// transpile:main
import { connectToDevice } from '../../index.js';
import { CONNECTION_TYPES } from '../constants';

async function start () {
  let adb = connectToDevice(CONNECTION_TYPES.USB);
  await adb.start();
  console.log("device started");
  let command = {
    type: "reboot"
  };
  await adb.open(command);
  console.log("device should reboot now");
}

console.log("starting");
start();