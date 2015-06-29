import { CONNECTION_TYPES } from './constants';
import USBDevice from './usb-device';

// create one of these to interface with a device
class ADBDevice {
  constructor(connectionType) {
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
    return;
  }

  // open a stream to a certain path on the device
  // as an example, shell: opens a shell into the device
  async open (command) {
    await this.device.openStream(command);
    return;
  }
}

export default ADBDevice;
