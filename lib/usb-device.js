// import constants
import { LIBUSB_VALUES } from './constants';
import { generateMessage, packetFromBuffer, logExceptOnTest  } from './helpers';

// required libraries
import _ from 'underscore';
import Promise from 'bluebird';
// local constants
const LIBUSB_TRANSFER_TYPE_BULK = LIBUSB_VALUES.LIBUSB_TRANSFER_TYPE_BULK;

class USBDevice {
  constructor (device, deviceInterface) {
    this.device = device;
    this.deviceInterface = deviceInterface;
  }

  // opens the device and sets up the endpoints for out object
  claimDevice () {
    logExceptOnTest("Trying to claim the device.");
    // we need to call these in OSX, see nonolith/nodeusb issue#61
    if (process.platform === 'darwin') {
      this.device.__open();
      this.device.__claimInterface(0);
    }
    this.device.open();
    logExceptOnTest("Device opened.");
    this.deviceInterface = Promise.promisifyAll(this.deviceInterface);
    this.deviceInterface.claim();
    // this line causes LIBUSB_ERROR_OTHER on S4s, but S4s and S5s work without it
    // await this.deviceInterface.setAltSettingAsync(0);
    let endpoints = this.deviceInterface.endpoints;
    this.setEndpoints(endpoints);
  }

  setEndpoints(endpoints) {
    if (endpoints[0].direction === "out") {
      this.inputEndpoint = endpoints[1];
      this.outputEndpoint = endpoints[0];
    } else {
      this.inputEndpoint = endpoints[0];
      this.outputEndpoint = endpoints[1];
    }
    this.inputEndpoint.transferType = LIBUSB_TRANSFER_TYPE_BULK;
    this.outputEndpoint.transferType = LIBUSB_TRANSFER_TYPE_BULK;
    this.inputEndpoint.timeout = 2000;
    this.outputEndpoint = Promise.promisifyAll(this.outputEndpoint);
    this.inputEndpoint = Promise.promisifyAll(this.inputEndpoint);
  }

  // sends a message as an adb packet followed by the payload if necessary
  async _sendMsg (cmd, arg1, arg2, payload) {
    let adbPacket = generateMessage(cmd, arg1, arg2, payload);
    await this.outputEndpoint.transferAsync(adbPacket);
    if (payload !== "") {
      if (_.isNumber(payload)) {
        payload = payload.toString();
      } else if (typeof payload !== Buffer) {
        payload = new Buffer(payload);
      }
      await this.outputEndpoint.transferAsync(payload);
    }
  }

  // receives a message from a device
  // handles reading the adb packet and if necessarry the data payload
  async _recvMsg (amount) {
    let data = await this.inputEndpoint.transferAsync(amount);
    let dataLen = data.readUInt32LE(12);
    if (dataLen > 0) {
      let additionalData = await this.getPacketData(amount, dataLen);
      data = Buffer.concat([data, additionalData]);
    }
    let packet = packetFromBuffer(data);
    return packet;
  }

  async getPacketData (maxRead, amount) {
    let dataLen = amount;
    let data = new Buffer("");
    while (dataLen > 0) {
      let readData = await this.inputEndpoint.transferAsync(maxRead);
      dataLen = dataLen - readData.length;
      data = Buffer.concat([data, readData]);
    }
    return data;
  }

  async releaseDevice () {
    await this.deviceInterface.releaseAsync(true);
    this.device.close();
  }
}

export default USBDevice;
