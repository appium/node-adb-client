import ADBDevice from './lib/adb-device';

function connectToDevice (type) {
  return new ADBDevice(type);
}

export { connectToDevice };