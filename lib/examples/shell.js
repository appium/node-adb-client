import { connectToDevice } from '../../index.js';
import { CONNECTION_TYPES } from '../constants';

async function start () {
  console.log("wtf");
  let adb = connectToDevice(CONNECTION_TYPES.USB);
  await adb.start();
  console.log("device started");
  let command = {
    type:   "shell"
  , string: "ls"
  };
  await adb.open(command);
  console.log("shell opened");
}

console.log("starting");
start();
console.log("ending");