import StateMachine from 'fsm-as-promised';
import ADBDevice from './lib/adb-device';
import usb from 'usb';
import { logExceptOnTest } from './lib/helpers';
import { USB_VENDOR_IDS, ADB_VALUES } from './lib/constants';

class ADB {
  constructor () {
    this.stateMachine = StateMachine({
      condition: 0,
      device: null,
      // initial: "startConnect",
      events: [
        { name: "start", from: "none", to: "startConnect" },
        { name: "sentCnxn", from: "startConnect", to: "waitForAuth" },
        { name: "recvdAuth", from: "waitForAuth", to: "auth1" },
        { name: "tokenAccepted", from: "auth1", to: "connected" },
        { name: "tokenRefused", from: "auth1", to: "auth2" },
        { name: "publicKeyAccepted", from: "auth2", to: "connected" },
        { name: "publicKeyRefused", from: "auth2", to: "startConnect" },
        { name: "timeout", from: "waitForAuth", to: "startConnect" },
        { name: "timeout", from: "auth1", to: "startConnect" },
        { name: "timeout", from: "auth2", to: "startConnect" }
      ],
      callbacks: {
        onenteredstartConnect: async function () {
          console.log("send cnxn");
          await this.device.initConnection();
          this.sentCnxn();
        },
        onleavestartConnect: function () {
          console.log("leaving startConnect");
        },
        onsentCnxn: function() {
          console.log("sent cnxn");
        },
        onenteredwaitForAuth: async function () {
          console.log("waiting for auth from device");
          // we'd get the devices response here and
          try {
            this.token = await this.device.waitForAuth();
            this.recvdAuth();
          } catch (err) {
            if (err.errno === 2) {
              this.timeout();
            } else {
              throw err;
            }
          }
        },
        onleavewaitForAuth: async function () {
          console.log("recv'd auth from device");
          // send signed auth token
          await this.device.sendSignedToken(this.token);
        },
        onenteredauth1: async function () {
          try {
            if (await this.device.waitAuthResponse() === true) {
              this.tokenAccepted();
            } else {
              this.tokenRefused();
            }
          } catch(err) {
            if (err.errno === 2) {
              this.timeout();
            }
          }
        },
        ontokenAccepted: function () {
          console.log("signed token was accepted by device");
        },
        ontokenRefused: async function () {
          console.log("signed token was refused, need to send public key");
          await this.device.sendPublicKey();
        },
        onenteredauth2: async function () {
          console.log("wait for cnxn response to our public key");
          try {
            if (await this.device.waitAuthResponse() === true) {
              this.publicKeyAccepted();
            } else {
              console.log("public key was not accepted, weird");
              this.publicKeyRefused();
            }
          } catch(err) {
            if (err.errno === 2) {
              this.timeout();
            }
          }
        },
        ontimeout: async function () {
          console.log("timeout occured, returning to start");
          await this.device.closeConnection();
        },
        onpublicKeyAccepted: function () {
          console.log("public key accepted");
        }
      }
    });
  }

  // return an array of devices that have an adb interface
  static findAdbDevices () {
    logExceptOnTest("Trying to find a usb device.");
    let adbDevices = [];
    let usbDevices = usb.getDeviceList();
    let deviceIndex = 0;
    for (let device of usbDevices) {
      let deviceInterface = this.getAdbInterface(device);
      if (deviceInterface !== null) {
        logExceptOnTest("Found an ADB device.");
        adbDevices.push({device, deviceInterface});
        // device.serialNumber = await getSerialNumber(adbDevices, deviceIndex);
        deviceIndex++;
      }
    }
    return adbDevices;
  }

  selectDevice (connectionType, device) {
    this.stateMachine.device = new ADBDevice(connectionType, device);
  }

  start () {
    this.stateMachine.start();
  }

  // search through the devices interfaces for an interface that can be used for
  // adb communications
  static getAdbInterface (device) {
    device.open();
    if (device.interfaces === null) return null;
    // TypeError in plugin gulp-mocha with message Cannot redfine property: configDescriptor
    if (device.deviceDescriptor !== null && device.configDescriptor !== null) {
      let vendorID = device.deviceDescriptor.idVendor;

      // if the vendorID is not part of the vendors we recognize
      if (USB_VENDOR_IDS.indexOf(vendorID) === -1) return null;

      let interfaces = device.interfaces;
      let returnInterface = null;
      for (let iface of interfaces) {
        let currentInterface = iface;
        // adb interface will only have 2 endpoints
        if (currentInterface.endpoints.length !== 2) continue;
        let interfaceDescriptor = currentInterface.descriptor;
        // interface for ADB always has these values in it's descriptor
        if (interfaceDescriptor.bInterfaceClass !== ADB_VALUES.ADB_CLASS ||
            interfaceDescriptor.bInterfaceSubClass !== ADB_VALUES.ADB_SUBCLASS ||
            interfaceDescriptor.bInterfaceProtocol !== ADB_VALUES.ADB_PROTOCOL) {
          continue;
        }
        //if we get to this point we should have the interface we want
        returnInterface = iface;
        break;
      }
      return returnInterface;
    }
    // should there be an else or return null here?
  }

  // returns the devices serial number
  static async getSerialNumber (device) {
    let langId = 0x0409;
    let length = 255;
    let deviceDescriptor = device.deviceDescriptor;
    let controlTransferAsync = Promise.promisify(device.controlTransfer, device);
    let serialNumber = await controlTransferAsync(usb.LIBUSB_ENDPOINT_IN
                                                 , usb.LIBUSB_REQUEST_GET_DESCRIPTOR
                                                 , (usb.LIBUSB_DT_STRING << 8) | deviceDescriptor.iSerialNumber
                                                 , langId
                                                 , length);
    console.log("serialNumber: ", serialNumber.toString());
    return serialNumber.toString('utf16le', 2);
  }

  static async getSerialNumbers (devices) {
    for (let device of devices) {
      let currentDevice = device.device;
      device.serialNumber = await this.getSerialNumber(currentDevice);
    }
  }
}

export default ADB;