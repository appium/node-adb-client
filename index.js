import ADBDevice from './lib/adb-device';

function connectToDevice (type, device) {
  return new ADBDevice(type, device);
}

export { connectToDevice };