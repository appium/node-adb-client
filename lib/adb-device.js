import { CONNECTION_TYPES, ADB_COMMANDS } from './constants';
import USBDevice from './usb-device';

// create one of these to interface with a device
class ADBDevice {
  constructor(connectionType) {
    console.log("in ADBDevice ctor");
    this.device = null;
    if (connectionType === CONNECTION_TYPES.USB) {
      console.log("Creating a usb device.");
      this.device = USBDevice.findAdbDevice();
    } else if (connectionType === CONNECTION_TYPES.TCP) {
      // insert tcp things
    } else {
      // errors yo
      throw new Error("Invalid connection type.");
    }
  }

  // initiates connection to the device and then
  // registers for any events needed to get data
  async start () {
    await this.device.initConnection();
    console.log("connectToDevice finished");
    return;
  }

  // open a stream to a certain path on the device
  // as an example, shell: opens a shell into the device
  async open (command) {
    console.log("inside openStream");
    await this.device.openStream(command);
    console.log("path opened");
    return;
  }
}

export default ADBDevice;