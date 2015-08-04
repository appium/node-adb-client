// transpile:main
import { connectToDevice } from '../../index.js';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';

async function start () {
  let adb = connectToDevice(CONNECTION_TYPES.USB);
  await adb.start();

  console.log("Device started.");
  let command = {
    type: "pull"
  , source: "sdcard/test.py"
  , destination: "/Users/callumstyan/"
  };
  await adb.open(command);
  console.log("shell opened");
  console.log("closing device!");
  await adb.closeConnection();
}

console.log("Starting!");
asyncify(start);