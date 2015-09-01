// import constants
import { CONNECT_VALUES, ADB_COMMANDS, ADB_KEY
       , LIBUSB_VALUES, ADB_SUBCOMMANDS } from './constants';
let MAXDATA = CONNECT_VALUES.CONNECT_MAXDATA;
import { generateMessage, packetFromBuffer, getFileName } from './helpers';

// required libraries
import _ from 'underscore';
import path from 'path';
import fs from 'fs';
import Promise from 'bluebird';
import through2 from 'through2';

// local constants
const homedir = process.platform === 'win32' ? process.env.HOMEPATH
                                             : process.env.HOME;
const keyPath = path.join(homedir, ADB_KEY.PUBLIC_KEY);
const publicKeyString = fs.readFileSync(keyPath);
const LIBUSB_ENDPOINT_IN = LIBUSB_VALUES.LIBUSB_ENDPOINT_IN
    , LIBUSB_TRANSFER_TYPE_BULK = LIBUSB_VALUES.LIBUSB_TRANSFER_TYPE_BULK;
const MAX_READ = 4096; // don't send a packet with more than this amount
const MAX_SIZE = 65536; // max size we can have in one DATA<size>
const installLocation = "/data/local/tmp/";
const dataIndicator = new Buffer("DATA");

const statAsync = Promise.promisify(fs.stat);
// const readAsync = Promise.promisify(fs.read);
// const openAsync = Promise.promisify(fs.open);
// const readFileAsync = Promise.promisify(fs.readFile);

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

  // recv a packet from the device and respond with okay so we can recv again
  async _recvAndOkay (arg1, arg2) {
    let packet = await this._recvMsg(MAXDATA);
    await this._sendMsg(ADB_COMMANDS.CMD_OKAY
                       , arg1
                       , arg2
                       , "");
    return packet;
  }

  // recv chunks of a file from the device until we read DONE at the end of a msg
  async _recvFile (localId, remoteId) {
    let run = 1;
    let data = null;
    do {
      let packet = await this._recvAndOkay(localId, remoteId);
      let done = packet.data.readUInt32LE(packet.data.length - 8);
      if (done === ADB_SUBCOMMANDS.CMD_DONE) {
        run = 0;
      }
      if (data !== null) {
        data = Buffer.concat([data, packet.data]);
      } else {
        data = packet.data;
      }
    } while (run === 1);
    return data;
  }

  // go through the entire buffer recv'd for a file and remove the ADB pull
  // related data so that we're left with just the actual file data
  _parseFileData (rawData) {
    let currentPosition = 0;
    let fileData = new Buffer("");
    while (true) {
      // get the DATA<length> so we know how much to copy
      let length = rawData.readUInt32LE(currentPosition + 4);
      currentPosition += 8;
      console.log("length: ", length);
      let chunk  = new Buffer(length);
      rawData.copy(chunk, 0, currentPosition, currentPosition + length);
      currentPosition += length;
      fileData = Buffer.concat([fileData, chunk]);
      if (rawData.readUInt32LE(currentPosition) === ADB_SUBCOMMANDS.CMD_DONE) {
        break;
      }
    }
    return fileData;
  }

  // technically not a loop
  async _fileLoop (filePath, fileStats, devicePath, localId, remoteId) {
    let sendBuffer = new Buffer(`${devicePath},${fileStats.mode}`);
    let self = this;

    fs.createReadStream(filePath)
      .pipe(through2(function (chunk, encoding, done) {
        // holds data before we push it to the next stream so we can prepend
        // the necessary DATA<size> headers
        let pushData = new Buffer("");
        if (chunk.length > MAX_SIZE || chunk.length < MAX_SIZE) {
          console.log("length: ", chunk.length);
        }
        let sizeBuffer = new Buffer(4);
        sizeBuffer.writeUInt32LE(chunk.length);
        sendBuffer = Buffer.concat([sendBuffer, dataIndicator, sizeBuffer]);
        pushData = Buffer.concat([sendBuffer, chunk]);
        if (chunk.length < MAX_SIZE) {
          let doneBuffer = new Buffer("DONE");
          let mTimeBuffer = new Buffer(4);
          mTimeBuffer.writeUInt32LE(fileStats.mtime.getTime() / 1000, 0);
          pushData = Buffer.concat([pushData, doneBuffer, mTimeBuffer]);
        }

        while (pushData.length !== 0) {
          let copyAmount = pushData.length > MAX_READ ? MAX_READ : pushData.length;
          let copyBuffer = new Buffer(copyAmount);
          pushData.copy(copyBuffer, 0, 0, copyAmount);
          pushData = pushData.slice(copyAmount);
          console.log("copyBuffer length:", copyBuffer.length);
          this.push(copyBuffer);
        }
        // clear buffer for next time, since the first time we have the ADB data
        // we need to also send the destination and mode of the file, but after
        // that time we only need DATA<size>
        sendBuffer = new Buffer("");
        done();
      }))
      .pipe(through2(function(chunk, encoding, done) {
        let packet = self._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                      , localId
                                      , remoteId
                                      , chunk)
                                      .catch(done).then((packet) => {
                                        if(packet.data) {
                                          done(new Error("oops: ", packet.data));
                                          return;
                                        }
                                        done();
                                      });
      }));
  }

  // function to send a file to the device, part of _push flow
  // gets some stats about the file, calls _fileLoop, and then finishes
  // off the push flow and closes the stream
  async _sendFile (filePath, destination, localId, remoteId) {
    let fileName = getFileName(filePath);
    // path where the file will end up on the device, including the file name
    let devicePath = `${destination}/${fileName}`;
    let stats = await statAsync(filePath);
    await this._fileLoop(filePath, stats, devicePath, localId, remoteId);
    console.log("file sending is finished");
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
  async _push (source, destination) {
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
    await this._stat(destination, localId, remoteId);
    // tell the device we want to send it something
    let devicePath = `${destination}/${fileName}`;
    let sendBuffer = new Buffer(8);
    sendBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_SEND, 0);
    sendBuffer.writeUInt32LE(devicePath.length + 6, 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , sendBuffer);
    console.log("send file time");
    // start sending actual file data
    await this._sendFile(source, destination, localId, remoteId);
  }

  // runs ADB pull to pull a file from the device to the local machine
  async _pull (source, destination) {
    console.log("Pull");
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
    packet = await this._stat(source, localId, remoteId);
    if (packet.data.readUInt32LE(4) === 0) { // file doesn't exist
      console.log("The file you're trying to pull doesn't exist");
      await this._clientClose(localId, remoteId);
      return;
    }

    // tell the device we want to receive the file
    let recvBuffer = new Buffer(8);
    recvBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_RECV, 0);
    recvBuffer.writeUInt32LE(source.length, 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , recvBuffer);
    // send the path to the file we want again
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                           , localId
                           , remoteId
                           , source);
    console.log("sent final source");
    // recv the file data from the device
    let rawData = await this._recvFile(localId, remoteId);
    // create a buffer from the packet data so we can read
    // the fields as 32bit words
    let fileData = this._parseFileData(rawData);
    // write data to a local file
    let writeAsync = Promise.promisify(fs.writeFile);
    await writeAsync(destination, fileData);
  }

  // get a files stats as part of the adb protocol, not equivalent to fs.stat
  async _stat (remotePath, localId, remoteId) {
    // tell the device we're going to want stats about a file
    let statBuffer = new Buffer(8);
    statBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_STAT, 0);
    statBuffer.writeUInt32LE(remotePath.length, 4);
    let packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , statBuffer);
    // investigate why this needs be sent twice in order to get past
    // this step in the flow
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , remotePath);
    packet = await this._recvAndOkay(localId, remoteId);
    return packet;
  }

  // install an APK on the device, uses _push and _shell
  async _install (apkSource) {
    await this._push(apkSource, installLocation);
    let fileName = getFileName(apkSource);
    let shellString = `pm install ${installLocation}${fileName}`;
    await this._shell(shellString);
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

  // send a close to the device and recv a close back from it
  async _clientClose(localId, remoteId) {
    await this._sendMsg(ADB_COMMANDS.CMD_CLSE
                       , localId
                       , remoteId
                       , "");
    await this._recvMsg(MAXDATA);
  }

  // opens a stream to the device for running a single command
  // this is a stream in the context of the device, not a node stream
  // does not work for interactive shell uses
  async openStream (command) {
    console.log("open");
    switch (command.type) {
      case "shell":
        await this._shell(command.string);
        break;
      case "push":
        await this._push(command.source, command.destination);
        break;
      case "pull":
        await this._pull(command.source, command.destination);
        break;
      case "install":
        await this._install(command.source);
        break;
      case "reboot":
        console.log("reboot");
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
