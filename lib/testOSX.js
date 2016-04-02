// transpile:main

// import { CONNECTION_TYPES, ADB_COMMANDS, CONNECT_VALUES
       // , ADB_KEY, ADB_SUBCOMMANDS } from './constants';
// import { getFileName, parseFileData, findAdbDevices } from './helpers';
import { connectToDevice } from '../index.js';
import { CONNECTION_TYPES } from './constants';
import { findAdbDevices } from './helpers';
import { asyncify } from 'asyncbox';

async function start() {
  let availableDevices = findAdbDevices();
  let adb = connectToDevice(CONNECTION_TYPES.USB, availableDevices[0]);
  await adb.initConnection();
  console.log(adb);
  await adb.closeConnection();
}

asyncify(start);