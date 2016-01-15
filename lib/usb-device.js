// import constants
import { LIBUSB_VALUES } from './constants';
import { generateMessage, packetFromBuffer  } from './helpers';

// required libraries
import _ from 'underscore';
import Promise from 'bluebird';
// local constants
const LIBUSB_ENDPOINT_IN = LIBUSB_VALUES.LIBUSB_ENDPOINT_IN
    , LIBUSB_TRANSFER_TYPE_BULK = LIBUSB_VALUES.LIBUSB_TRANSFER_TYPE_BULK;

class USBDevice {
  constructor(device, deviceInterface) {
    this.device = device;
    this.deviceInterface = deviceInterface;
  }

  // opens the device and sets up the endpoints for out object
  async claimDevice () {
    console.log("Trying to claim the device.");
    // we need to call these in OSX, see nonolith/nodeusb issue#61
    if (process.platform === 'darwin') {
      this.device.__open();
      this.device.__claimInterface(0);
    }
    this.device.open();
    console.log("Device opened.");
    this.deviceInterface = Promise.promisifyAll(this.deviceInterface);
    // this.deviceInterface.releaseAsync(true); this is breaking the state machine
    this.deviceInterface.claim();
    // this line causes LIBUSB_ERROR_OTHER on S4s, but S4s and S5s work without it
    // await this.deviceInterface.setAltSettingAsync(0);
    let endpoints = this.deviceInterface.endpoints;
    // set the endpoints for our USBDevice object
    // note that these endpoints are on the device, so it's endpoint in
    // is our endpoint out, the endpoint we want to send data to
    if (endpoints[0] === LIBUSB_ENDPOINT_IN) {
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
    let packet = packetFromBuffer(data);
    if (packet.dataLen > 0) {
      let dataLen = packet.dataLen;
      while (dataLen > 0) {
        let readData = await this.inputEndpoint.transferAsync(amount);
        dataLen = dataLen - readData.length;
        packet.data = Buffer.concat([packet.data, readData]);
      }
    }
    return packet;
  }

  async releaseDevice () {
    await this.deviceInterface.releaseAsync(true);
    this.device.close();
  }
}

export default USBDevice;
