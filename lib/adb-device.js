import { CONNECTION_TYPES } from './constants';
import USBDevice from './usb-device';

// create one of these to interface with a device
class ADBDevice {
  constructor (connectionType, device) {
    if (connectionType === CONNECTION_TYPES.USB) {
      console.log("Creating a usb device.");
      // let foundDevice = findAdbDevices();
      this.serialNumber = device.serialNumber;
      this.device = new USBDevice(device.device, device.deviceInterface);
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
  }

  // open a stream to a certain path on the device
  // as an example, shell: opens a shell into the device
  async open (command) {
    console.log("open");
    switch (command.type) {
      case "shell":
        await this.device._shell(command.string);
        break;
      case "push":
        await this.device._push(command.source, command.destination);
        break;
      case "pull":
        await this.device._pull(command.source, command.destination);
        break;
      case "install":
        await this.device._install(command.source);
        break;
      case "reboot":
        console.log("reboot");
        await this.device._reboot();
        break;
      default:
        console.log("Sorry, that command type isn't supported yet.");
        break;
    }
    // await this.device.openStream(command);
  }

  async closeConnection () {
    await this.device.releaseDevice();
  }
}

export default ADBDevice;
