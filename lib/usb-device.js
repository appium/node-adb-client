// import constants
import { CONNECT_VALUES, ADB_COMMANDS, ADB_KEY
       , LIBUSB_VALUES } from './constants';
let MAXDATA = CONNECT_VALUES.CONNECT_MAXDATA;
// import helpers
import { generateMessage, packetFromBuffer } from './helpers';

// required libraries
import path from 'path';
import fs from 'fs';
import Promise from 'bluebird';

// local constants
const homedir = process.platform === 'win32' ? process.env.HOMEPATH
                  : process.env.HOME;
const keyPath = path.join(homedir, ADB_KEY.PUBLIC_KEY);
const publicKeyString = fs.readFileSync(keyPath);
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
    this.deviceInterface.claim();
    await this.deviceInterface.setAltSettingAsync(0);
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
    this.inputEndpoint.timeout = 2500;
    this.outputEndpoint = Promise.promisifyAll(this.outputEndpoint);
    this.inputEndpoint = Promise.promisifyAll(this.inputEndpoint);
  }

  // handles authentication between our machine and
  // the android device upon initial connection
  // TODO: attempt to sign token sent to us
  async handleAuth () {
    let publicKeyBuf = new Buffer(publicKeyString.length + 1);
    publicKeyString.copy(publicKeyBuf);
    publicKeyBuf[-1] = 0;
    let authMsg = generateMessage(ADB_COMMANDS.CMD_AUTH,
                                  3, 0, publicKeyBuf);

    let command = null;
    do {
      await this._sendMsg(authMsg);
      await this._sendMsg(publicKeyBuf);
      console.log("Sent auth message and public key.");
      let packet = await this._recvMsg(MAXDATA);
      //TODO, actually check the fields of the packet
      if (packet.command === ADB_COMMANDS.CMD_CNXN) {
        // we need to read the string about the device that gets sent back
        // await this.inputEndpoint.transferAsync(MAXDATA);
        return;
      }
    } while (command !== ADB_COMMANDS.CMD_CNXN);
  }

  // calls claim device and then performs the ADB usb handshake
  // returns a promise, will have the error value if an error is thrown
  async initConnection () {
    await this.claimDevice();
    console.log("Trying to connect to device.");
    let connectMsg = generateMessage(ADB_COMMANDS.CMD_CNXN
                                    , CONNECT_VALUES.CONNECT_VERSION
                                    , CONNECT_VALUES.CONNECT_MAXDATA
                                    , CONNECT_VALUES.CONNECT_PAYLOAD);
    let hostBuf = new Buffer(CONNECT_VALUES.CONNECT_PAYLOAD);
    await this._sendMsg(connectMsg);
    await this._sendMsg(hostBuf);
    console.log("Sent connect message.");
    let packet = await this._recvMsg(MAXDATA);
    if (packet.command === ADB_COMMANDS.CMD_AUTH) {
      console.log("AUTH received.");
      await this.handleAuth();
    }
  }

  // sends a message, checks that message is a Buffer
  async _sendMsg (msg) {
    // this error checking breaks the function :/
    // if(typeof msg !== Buffer) {
    //   throw new Error("Message was not of type Buffer.");
    // }
    return await this.outputEndpoint.transferAsync(msg);
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

  async _shell (commandString) {
    console.log("inside shell function");
    let shellString = "shell:" + commandString + ".";
    let openMsg = generateMessage(ADB_COMMANDS.CMD_OPEN
                                  , 12345
                                  , 0
                                  , shellString);
    let shellBuf = new Buffer(shellString);
    await this._sendMsg(openMsg);
    await this._sendMsg(shellBuf);
    // we should get an OKAY here
    let packet = await this._recvMsg(MAXDATA);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    let command = packet.command;
    if (command !== ADB_COMMANDS.CMD_OKAY) {
      throw new Error("OPEN response was not OKAY.");
    }
    // we need to send an OKAY in order to get the next WRTE message
    let okayMsg = generateMessage(ADB_COMMANDS.CMD_OKAY
                                  , localId
                                  , remoteId
                                  , "");
    // we want to read packets from the device until we get one with
    // a command of CLSE, which signals the end of the transmission
    do {
      packet = await this._recvMsg(MAXDATA);
      command = packet.command;
      if (command === ADB_COMMANDS.CMD_WRTE) {
        console.log(packet.data.toString());
        await this._sendMsg(okayMsg);
      } else {
        console.log("command was clse? ", command === ADB_COMMANDS.CMD_CLSE);
      } 
    } while (command !== ADB_COMMANDS.CMD_CLSE);
    console.log("_shell read loop ended");
    // we got a CLSE, now we send a CLSE
    let clseMsg = generateMessage(ADB_COMMANDS.CMD_CLSE
                              , localId
                              , remoteId
                              , "");
    await this._sendMsg(clseMsg);
    console.log("sent CLSE");
  }

  async _reboot() {
    let rebootString = "reboot:" + ".";
    let rebootBuffer = new Buffer(rebootString);
    let openMsg = generateMessage(ADB_COMMANDS.CMD_OPEN
                                 , 12345
                                 , 0
                                 , rebootBuffer);
    await this._sendMsg(openMsg);
    await this._sendMsg(rebootBuffer);
    await this._recvMsg(MAXDATA);
  } 

  // opens a stream to the device for running a single command
  // this is a stream in the context of the device, not a node stream
  // does not work for interactive shell uses
  async openStream (command) {
    switch (command.type) {
      case "shell":
        await this._shell(command.string);
        break;
      case "reboot":
        await this._reboot();
        break;
      default:
        console.log("Sorry, that command type isn't supported yet.");
        break;
    }
  }

  async releaseDevice () {
    await this.deviceInterface.releaseAsync(true);
    this.device.close();
  }
}

export default USBDevice;
