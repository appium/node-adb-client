// transpile:main
import ADB from '../../adb';
import { CONNECTION_TYPES } from '../constants';
import { asyncify } from 'asyncbox';

async function start () {
  let availableDevices = ADB.findAdbDevices();
  if (availableDevices.length > 0) {
    // await ADB.getSerialNumbers(availableDevices);
    // just select the first device
    let connection = new ADB();
    connection.selectDevice(CONNECTION_TYPES.USB, availableDevices[0]);
    // await adb.initConnection();
    connection.start();
    console.log("Device started.");
    let command = {
      type:   "shell"
    , string: "ls"
    };
    // ideally we should be able to just have connection.open and connection.end
    // instead of this mess, need to figure out what's causing stopping me from
    // being able to run things in sequence since the switch to a state machine
    let run = 1;
    while (run === 1) {
      try {
        setTimeout(function () {
          connection.open(command);
        }, 5000);
        run = 0;
        await connection.end();
      } catch (err) {
        console.log(err);
      }
    }
    // await adb.open(command);
    // console.log("shell opened");
    // console.log("closing device!");
    // await adb.closeConnection();
  } else {
    console.log("no devices found");
  }
}

console.log("Starting.");
asyncify(start);
