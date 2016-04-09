import usb from 'usb';
import { USB_VENDOR_IDS, ADB_VALUES, CONNECTION_TYPES } from './lib/constants';
import { logExceptOnTest } from './lib/helpers';
import ADBDevice from './lib/adb-device';

const NOT_CONNECTED = 0;
const WAIT_FOR_AUTH = 1;
const SEND_PRIVATE_KEY = 2;
const SEND_PUBLIC_KEY = 3;
const CONNECTED = 4;

class ADB {
  constructor (connectionType, device) {
    if (connectionType !== (CONNECTION_TYPES.USB || CONNECTION_TYPES.TCP)) {
      throw new Error("Cannot create new ADB device, invalid connection type.");
    }
    this.state = NOT_CONNECTED;
    this.device = new ADBDevice(connectionType, device);
  }

  // *** STATIC FUNCTIONS ***
  // return an array of devices that have an ADB interface
  static findAdbDevices () {
    logExceptOnTest("Trying to find a usb device");
    let adbDevices = [];
    let usbDevices = usb.getDeviceList();
    for (let device of usbDevices) {
      let deviceInterface = this.getAdbInterface(device);
      if (deviceInterface !== null) {
        logExceptOnTest("Found an ADB device");
        adbDevices.push({device, deviceInterface});
      }
    }
    return adbDevices;
  }

  // search through a devices interfaces for an interface
  // that can be used for ADB communications
  static getAdbInterface (device) {
    device.open();
    if (device.interfaces === null) return null;

    if (device.deviceDescriptor !== null && device.configDescriptor !== null) {
      // if the vendorID is not part of the vendors we recognize
      let vendorID = device.deviceDescriptor.idVendor;
      if (USB_VENDOR_IDS.indexOf(vendorID) === -1) return null;
      let interfaces = device.interfaces;
      let returnInterface = null;
      for (let iface of interfaces) {
        // ADB interface will only have two endpoints
        if (iface.endpoints.length !== 2) continue;
        // interface for ADB always has these values in it's descriptor
        if (iface.descriptor.bInterfaceClass !== ADB_VALUES.ADB_CLASS ||
          iface.descriptor.bInterfaceSubClass !== ADB_VALUES.ADB_SUBCLASS ||
          iface.descriptor.bInterfaceProtocol !== ADB_VALUES.ADB_PROTOCOL) {
          continue;
        }
        // if we get to this point we have the interface we want
        returnInterface = iface;
        break;
      }
      return returnInterface;
    }
  }
  // *** END OF STATIC FUNCTIONS ***

  // runs the connection state machine
  async connect () {
    let packet;
    while (1) {
      switch (this.state) {
        case NOT_CONNECTED:
          console.log("NOT_CONNECTED");
          await this.device.initConnection();
          this.state = WAIT_FOR_AUTH;
          break;
        case WAIT_FOR_AUTH:
          console.log("WAIT_FOR_AUTH");
          try {
            packet = await this.device.waitForAuth();
            if (packet === false) {
              this.state = NOT_CONNECTED;
            } else {
              this.state = SEND_PRIVATE_KEY;
            }
          } catch (e) {
            if (e.errno) {
              console.log("Timeout error, this should never happen: ", this.state);
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case SEND_PRIVATE_KEY:
          console.log("SEND_PRIVATE_KEY");
          try {
            if (await this.device.sendSignedToken(packet.data)) {
              this.state = CONNECTED;
            } else {
              this.state = SEND_PUBLIC_KEY;
            }
          } catch (e) {
            if (e.errno === 2) {
              console.log("Timeout error, this should never happen: ", this.state);
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case SEND_PUBLIC_KEY:
          console.log("SEND_PUBLIC_KEY");
          try {
            if (await this.device.sendPublicKey()) {
              this.state = CONNECTED;
            } else {
              this.state = NOT_CONNECTED;
            }
          } catch (e) {
            if (e.errno === 2) { //timeout error
              console.log("Timeout error, did you accept the public key on the device?");
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case CONNECTED: // ready to start runing command on the device now
          console.log("CONNECTED");
          return;
        default: //wtf
          this.state = NOT_CONNECTED;
      }
    }
  }

  async runCommand (command) {
    if (this.state === CONNECTED) {
      await this.device.open(command);
    }
    // else log, not ready to run a command/open a stream
  }

  async initConnection () {
    if (this.state === NOT_CONNECTED) {
      await this.device.initConnection();
      this.state = CONNECTED;
    }
    // else log maybe?
  }

  async closeConnection () {
    if (this.state === CONNECTED) {
      await this.device.closeConnection();
    }
  }
}

export default ADB;