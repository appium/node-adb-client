// import constants
import { CONNECT_VALUES, ADB_COMMANDS, ADB_KEY
       , LIBUSB_VALUES, ADB_SUBCOMMANDS } from './constants';
let MAXDATA = CONNECT_VALUES.CONNECT_MAXDATA;
import { generateMessage, packetFromBuffer } from './helpers';

// required libraries
import _ from 'underscore';
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
    this.inputEndpoint.timeout = 2000;
    this.outputEndpoint = Promise.promisifyAll(this.outputEndpoint);
    this.inputEndpoint = Promise.promisifyAll(this.inputEndpoint);
  }

  // handles authentication between our machine and
  // the android device upon initial connection
  // TODO: attempt to sign token sent to us rather than just send our .pub
  async handleAuth () {
    let publicKeyBuf = new Buffer(publicKeyString.length + 1);
    publicKeyString.copy(publicKeyBuf);
    publicKeyBuf[-1] = 0;

    let command = null;
    do {
      await this._sendMsg(ADB_COMMANDS.CMD_AUTH, 3, 0, publicKeyBuf);
      console.log("Sent auth message and public key.");
      let packet = null;
      try {
        packet = await this._recvMsg(MAXDATA);
      } catch(err) {
        return err;
      }
      command = packet.command;
      //TODO, actually check the fields of the packet
      if (packet.command === ADB_COMMANDS.CMD_CNXN) {
        // we need to read the string about the device that gets sent back
        // await this.inputEndpoint.transferAsync(MAXDATA);
        return true;
      }
    } while (command !== ADB_COMMANDS.CMD_CNXN);
  }

  // calls claim device and then performs the ADB usb handshake
  // returns a promise, will have the error value if an error is thrown
  async initConnection () {
    await this.claimDevice();
    console.log("Trying to connect to device.");
    await this._sendMsg(ADB_COMMANDS.CMD_CNXN
                       , CONNECT_VALUES.CONNECT_VERSION
                       , CONNECT_VALUES.CONNECT_MAXDATA
                       , CONNECT_VALUES.CONNECT_PAYLOAD);
    console.log("Sent connect message.");
    let packet = await this._recvMsg(MAXDATA);
    if (packet.command === ADB_COMMANDS.CMD_AUTH) {
      console.log("AUTH received.");
      let run = true;
      do {
        let auth = await this.handleAuth();
        if (auth === true) {
          run = false;
        } else if (auth.errno === 2) { // timeout error
          console.log("Read in handleAuth timed out");
          continue;
        } else {
          throw auth;
        }
      } while (run === true);
    }
    console.log("End of initConnection.");
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

  // this function calls _send message and then tries to
  // recv an OKAY back from the device, use when sending
  // lots of packets to the device to instead of straight
  // _sendMsg and _recvMsg calls
  async _sendAndOkay (cmd, arg1, arg2, payload) {
    await this._sendMsg(cmd, arg1, arg2, payload);
    // need to check to make sure this in an OKAY
    console.log("awaiting okay");
    return await this._recvMsg(MAXDATA);
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

  // this function gets the actual file name from the full path we entered in
  // the command arguments, generates the string with the file path, mode, etc.
  // in the format that the device expects, and then begins to send the files
  // actual data
  // at the moment this function won't handle files that are larger than one
  // usb packet size, needs to be refactored to loop and continue to send data
  // with the DATAlength,payload format
  async _sendFile(filePath, destination, localId, remoteId) {
    let statAsync = Promise.promisify(fs.stat);
    let readFileAsync = Promise.promisify(fs.readFile);
    // get the file name
    let splitArray = filePath.split("/");
    let fileName = splitArray[splitArray.length -1];
    // path where the file will end up on the device, including the file name
    let devicePath = `${destination}/${fileName}`;
    // we should be dynamically calculating this value in the future
    // so that we can send the max amount of data per packet, EFFICIENCY! :)
    // const maxReadSize = 384;
    let stats = await statAsync(filePath);
    let fileData = await readFileAsync(filePath);
    let modifiedTime = stats.mtime.getTime() / 1000; //convert ms to s
    // create the payload buffer, this is pretty ugly
    let pathBuffer = new Buffer(`${devicePath},${stats.mode}DATA`);
    let sizeBuffer = new Buffer(4);
    sizeBuffer.writeUInt32LE(stats.size, 0);
    let dataBuffer = new Buffer(`${fileData}DONE`);
    let mTimeBuffer = new Buffer(4);
    mTimeBuffer.writeUInt32LE(modifiedTime, 0);
    let payloadBuffer = Buffer.concat([pathBuffer, sizeBuffer, dataBuffer, mTimeBuffer]);
    // we're going to need to change how we read the file
    // and how we send it in the future in order to handle
    // bigger file sizes, there should be a loop of some sort here
    await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , payloadBuffer);
    // the device is going to send us a WRTE containing an OKAY as the data
    await this._recvMsg(MAXDATA);
    // now we send it the same thing back
    await this._sendMsg(ADB_COMMANDS.CMD_WRTE
                       , localId
                       , remoteId
                       , ADB_COMMANDS.CMD_OKAY);
    // send QUIT and get an OKAY back
    await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , ADB_SUBCOMMANDS.CMD_QUIT);
    // send CLSE and then recv CLSE back from the device
    await this._sendMsg(ADB_COMMANDS.CMD_CLSE
                       , localId
                       , remoteId
                       , "");
    await this._recvMsg(MAXDATA);
  }

  // runs an ADB shell command on the device, such as shell ls -al
  async _shell (commandString) {
    let shellString = `shell:${commandString}.`;
    let packet = await this._sendAndOkay(ADB_COMMANDS.CMD_OPEN
                             , 12345
                             , 0
                             , shellString);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    let command = packet.command;
    if (command !== ADB_COMMANDS.CMD_OKAY) {
      throw new Error("OPEN response was not OKAY.");
    }
    // we want to read packets from the device until we get one with
    // a command of CLSE, which signals the end of the transmission
    do {
      packet = await this._recvMsg(MAXDATA);
      command = packet.command;
      if (command === ADB_COMMANDS.CMD_WRTE) {
        console.log(packet.data.toString());
        // send an okay so the device knows it can send us more data
        await this._sendMsg(ADB_COMMANDS.CMD_OKAY
                           , localId
                           , remoteId
                           , "");
      } else {
        console.log("Command was CLSE? ", command === ADB_COMMANDS.CMD_CLSE);
      }
    } while (command !== ADB_COMMANDS.CMD_CLSE);
    console.log("_shell read loop ended.");
    // we got a CLSE, now we send a CLSE
    await this._sendMsg(ADB_COMMANDS.CMD_CLSE
                       , localId
                       , remoteId
                       , "");
    console.log("Sent CLSE.");
  }

  // runs ADB push to push a file to the device
  // this function is still to big and ugly, break into smaller pieces soon
  async _push (destination, source) {
    let syncBuf = new Buffer("sync:.");
    // open a SYNC stream on the device for pushing the file
    let packet = await this._sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                        , 12345
                                        , 0
                                        , syncBuf);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    // get the length of the file name for our stat command
    let splitArray = source.split("/");
    let fileName = splitArray[splitArray.length -1];
    // send STAT to check if the file already exists
    let statBuffer = new Buffer(8);
    statBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_STAT, 0);
    statBuffer.writeUInt32LE(fileName.length, 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , statBuffer);
    // send the destination so the device knows where to look for the file
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , destination);
    // this should be a WRTE -> STAT message, the STAT contains stats about the
    // directory destination we're trying to push a file to
    packet = await this._recvMsg(MAXDATA);
    // reply with an okay
    await this._sendMsg(ADB_COMMANDS.CMD_OKAY
                       , localId
                       , remoteId
                       , "");
    // tell the device we want to send it something, this is also very ugly
    // this protocol is so inconsistent in how it wants things to be written
    let devicePath = `${destination}/${fileName}`;
    let sendBuffer = new Buffer(8);
    sendBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_SEND, 0);
    // for example, if the length is 15, we don't write the hex equivalent of 15,
    // Ox0f, we actually write 15, as in 0x15
    sendBuffer.writeInt32LE(parseInt(`0x${devicePath.length}`, 16), 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                              , localId
                              , remoteId
                              , sendBuffer);
    // start sending actual file data
    await this._sendFile(source, destination, localId, remoteId);
  }

  // runs ADB pull to pull a file from the device to the local machine
  async _pull (source, destination) {
    console.log(destination);
    console.log("pull");
    let syncBuf = new Buffer("sync:.");
    // open a SYNC stream on the device for pulling a file from the device
    let packet = await this._sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                        , 12345
                                        , 0
                                        , syncBuf);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    // tell the device we're going to want stats about a file
    let statBuffer = new Buffer(8);
    statBuffer.writeUInt32LE("STAT", 0);
    statBuffer.writeUInt32LE(source.length, 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , statBuffer);
    console.log("send STAT");
    // path to the file we want the stats of
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , source);
    // get the stats back from the device about the file we want
    packet = await this._recvMsg(MAXDATA);
    // send okay so we can recv more messages
    await this._sendMsg(ADB_COMMANDS.CMD_OKAY
                       , localId
                       , remoteId
                       , "");

    // tell the device we want to receive the file
    let recvBuffer = new Buffer(8);
    recvBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_STAT, 0);
    recvBuffer.writeUInt32LE(source.length, 4);
    await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , recvBuffer);
    // send the path to the file we want again
    await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , source);
    console.log("sent final source");
    // recv the file data from the device
    packet = await this._recvMsg(MAXDATA);
    let fileSize = packet.data.readUInt32LE(4);
    let fileData = packet.data.readUIntLE(8, fileSize);
    console.log(fileData.toString());
  }

  // pretty simple, reboots the device
  async _reboot() {
    let rebootString = "reboot:.";
    let rebootBuffer = new Buffer(rebootString);
    await this._sendAndOkay(ADB_COMMANDS.CMD_OPEN
                           , 12345
                           , 0
                           , rebootBuffer);
  }

  // opens a stream to the device for running a single command
  // this is a stream in the context of the device, not a node stream
  // does not work for interactive shell uses
  async openStream (command) {
    switch (command.type) {
      case "shell":
        await this._shell(command.string);
        break;
      case "push":
        await this._push(command.destination, command.source);
        // await this._push(command.destination, command.source);
        break;
      case "pull":
        await this._pull(command.source, command.destination);
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
