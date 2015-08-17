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

// local constants
const homedir = process.platform === 'win32' ? process.env.HOMEPATH
                                             : process.env.HOME;
const keyPath = path.join(homedir, ADB_KEY.PUBLIC_KEY);
const publicKeyString = fs.readFileSync(keyPath);
const LIBUSB_ENDPOINT_IN = LIBUSB_VALUES.LIBUSB_ENDPOINT_IN
    , LIBUSB_TRANSFER_TYPE_BULK = LIBUSB_VALUES.LIBUSB_TRANSFER_TYPE_BULK;
const maxRead = 3300;

const statAsync = Promise.promisify(fs.stat);
const readAsync = Promise.promisify(fs.read);
const openAsync = Promise.promisify(fs.open);
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

  // read chunks of the file in a loop and send each chunk until the whole
  // file has been sent
  async _fileLoop (fd, stats, localId, remoteId) {
    let bytesRead = maxRead;
    let fileSize = stats.size;
    let remaining = fileSize - bytesRead;
    let dataBuffer = null, readArray = null;
    while (bytesRead !== fileSize) {
      console.log("bytesRead ", bytesRead);
      console.log("remaining ", remaining);
      //console.log("",);
      if (remaining >= maxRead) {
        console.log("STIL DATA LEFT");
        readArray = await readAsync(fd, new Buffer(maxRead), 0, maxRead, bytesRead);
        console.log("read amount: ", readArray[0]);
        dataBuffer = new Buffer(readArray[1]);
        console.log("buffer length: ", dataBuffer.length);
      } else {
        console.log("DONE");
        readArray = await readAsync(fd, new Buffer(remaining), 0, remaining, bytesRead);
        console.log("bytes read: ", readArray[0]);
        console.log("readArray data length", readArray[1].length);
        let mTimeBuffer = new Buffer(4);
        mTimeBuffer.writeUInt32LE(stats.mtime.getTime() / 1000, 0);
        let doneBuffer = new Buffer("DONE");
        //dataBuffer = null;
        //let dataString = `${readArray[1]}DONE`;
        //console.log("dataString length: ", dataString.length);
        //dataBuffer = new Buffer(`${readArray[1]}DONE`, 'ascii');
        //console.log("dataBuffer length: ", dataBuffer.length);
        dataBuffer = Buffer.concat([readArray[1], doneBuffer, mTimeBuffer]);
        console.log("final dataBuffer length: ", dataBuffer.length);
      }
      bytesRead += readArray[0];
      console.log("total bytes read: ", bytesRead);
      console.log("file size: ", stats.size);
      remaining -= readArray[0];
      await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                             , localId
                             , remoteId
                             , dataBuffer);
    }
    console.log("file loop finished");
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

  async _sendFile (filePath, destination, localId, remoteId) {
    let fileName = getFileName(filePath);
    // path where the file will end up on the device, including the file name
    let devicePath = `${destination}/${fileName}`;
    let stats = await statAsync(filePath);
    let fileSize = stats.size;
    let modifiedTime = stats.mtime.getTime() / 1000; //convert ms to s
    let fd = await openAsync(filePath, 'r');
    let pathBuffer = new Buffer(`${devicePath},${stats.mode}DATA`);
    let sizeBuffer = new Buffer(4);
    sizeBuffer.writeUInt32LE(stats.size, 0);
    let mTimeBuffer = new Buffer(4);
    mTimeBuffer.writeUInt32LE(modifiedTime, 0);
    let readArray = null, dataBuffer = null;
    // packets seem to have a max size of 4160, we'll never read more than
    // 4000 from the file just to be safe
    if (fileSize < maxRead) {
      readArray = await readAsync(fd, new Buffer(stats.size), 0, stats.size, 0);
      dataBuffer = new Buffer(`${readArray[1]}DONE`);
      let payloadBuffer = Buffer.concat([pathBuffer, sizeBuffer, dataBuffer, mTimeBuffer]);
      await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                             , localId
                             , remoteId
                             , payloadBuffer);
    } else {
      console.log("fileSize is greater than 4k");
      readArray = await readAsync(fd, new Buffer(maxRead), 0, maxRead, 0);
      dataBuffer = new Buffer(`${readArray[1]}DONE`);
      let payloadBuffer = Buffer.concat([pathBuffer, sizeBuffer, dataBuffer, mTimeBuffer]);
      // // console.log("payloadBuffer: ", payloadBuffer.toString());
      console.log(payloadBuffer.length);
      await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                             , localId
                             , remoteId
                             , payloadBuffer);
      //console.log(packet);
      // console.log("initial send worked");
      await this._fileLoop(fd, stats, localId, remoteId);
    }
    console.log("file sending should be finished");
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

  // this function gets the actual file name from the full path we entered in
  // the command arguments, generates the string with the file path, mode, etc.
  // in the format that the device expects, and then begins to send the files
  // actual data
  // at the moment this function won't handle files that are larger than one
  // usb packet size, needs to be refactored to loop and continue to send data
  // with the DATAlength,payload format
  // async _sendFile(filePath, destination, localId, remoteId) {
  //   let fileName = getFileName(filePath);
  //   // path where the file will end up on the device, including the file name
  //   let devicePath = `${destination}/${fileName}`;
  //   let stats = await statAsync(filePath);
  //   let modifiedTime = stats.mtime.getTime() / 1000; //convert ms to s
  //   let fileData = await readFileAsync(filePath);
  //   // create the payload buffer, this is pretty ugly
  //   let pathBuffer = new Buffer(`${devicePath},${stats.mode}DATA`);
  //   let sizeBuffer = new Buffer(4);
  //   sizeBuffer.writeUInt32LE(stats.size, 0);
  //   let dataBuffer = new Buffer(`${fileData}DONE`);
  //   let mTimeBuffer = new Buffer(4);
  //   mTimeBuffer.writeUInt32LE(modifiedTime, 0);
  //   let payloadBuffer = Buffer.concat([pathBuffer, sizeBuffer, dataBuffer, mTimeBuffer]);
  //   // we're going to need to change how we read the file
  //   // and how we send it in the future in order to handle
  //   // bigger file sizes, there should be a loop of some sort here
  //   await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
  //                          , localId
  //                          , remoteId
  //                          , payloadBuffer);
  //   // the device is going to send us a WRTE containing an OKAY as the data
  //   await this._recvMsg(MAXDATA);
  //   // now we send it the same thing back
  //   await this._sendMsg(ADB_COMMANDS.CMD_WRTE
  //                      , localId
  //                      , remoteId
  //                      , ADB_COMMANDS.CMD_OKAY);
  //   // send QUIT and get an OKAY back
  //   await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
  //                          , localId
  //                          , remoteId
  //                          , ADB_SUBCOMMANDS.CMD_QUIT);
  //   // send CLSE and then recv CLSE back from the device
  //   await this._sendMsg(ADB_COMMANDS.CMD_CLSE
  //                      , localId
  //                      , remoteId
  //                      , "");
  //   await this._recvMsg(MAXDATA);
  // }

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
    statBuffer.writeUInt32LE(destination.length, 4);
    packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , statBuffer);

    // send the destination so the device knows where to look for the file
    // packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
    //                                 , localId
    //                                 , remoteId
    //                                 , destination);
    // this should be a WRTE -> STAT message, the STAT contains stats about the
    // directory destination we're trying to push a file to
    let continueRecv = 1;
    do{
      try {
        packet = await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                        , localId
                                        , remoteId
                                        , destination);
        console.log("waiting for WRTE -> STAT");
        packet = await this._recvMsg(MAXDATA);
        console.log(packet.data.toString());
        continueRecv = 0;
      } catch (err) {
        if (err.errno === 2) { // timeout errors
          console.log("timeout");
          continue;
        }
        throw err;
      }
    } while (continueRecv === 1);
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
    console.log(sendBuffer.toString());
    await this._sendAndOkay(ADB_COMMANDS.CMD_WRTE
                              , localId
                              , remoteId
                              , sendBuffer);
    //console.log(packet);
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
    let statBuffer = new Buffer(8);
    statBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_STAT, 0);
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
    packet = await this._recvAndOkay(MAXDATA);
    if (packet.data.readUInt32LE(4) === 0) { // file doesn't exist
      console.log("The file you're trying to pull doesn't exist");
      await this._clientClose(localId, remoteId);
      return;
    }
    // send okay so we can recv more messages
    // await this._sendMsg(ADB_COMMANDS.CMD_OKAY
    //                    , localId
    //                    , remoteId
    //                    , "");

    // tell the device we want to receive the file
    let recvBuffer = new Buffer(8);
    recvBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_RECV, 0);
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
    let fileData = await this._recvFile(localId, remoteId);
    // create a buffer from the packet data so we can read
    // the fields as 32bit words
    let length = fileData.readUInt32LE(4);
    // node v0.10.* doesn't support readUIntLE
    fileData = fileData.slice(8, 8 + length);
    // write data to a local file
    let writeAsync = Promise.promisify(fs.writeFile);
    await writeAsync(destination, fileData);
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
        console.log("push case");
        await this._push(command.destination, command.source);
        // await this._push(command.destination, command.source);
        break;
      case "pull":
        await this._pull(command.source, command.destination);
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
