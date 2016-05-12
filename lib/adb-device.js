import { CONNECTION_TYPES, ADB_COMMANDS, CONNECT_VALUES
       , ADB_KEY, ADB_SUBCOMMANDS, FILE_TYPES } from './constants';
import { getFileName, parseFileData, logExceptOnTest } from './helpers';
import USBDevice from './usb-device';

import { fs } from 'appium-support';
import path from 'path';
import _fs from 'fs';
import Promise from 'bluebird';
import * as signLib from '../Release/binding';

// local constants
const homedir = process.platform === 'win32' ? process.env.HOMEPATH
                                             : process.env.HOME;
const publickeyPath = path.join(homedir, ADB_KEY.PUBLIC_KEY);
const privateKeyPath = path.join(homedir, ADB_KEY.PRIVATE_KEY);
// we need all of this file before anything can happen with ADB
const publicKeyString = _fs.readFileSync(publickeyPath);
const installLocation = "/data/local/tmp/";
const uninstallString = "pm uninstall -k";

const MAX_DATA_SIZE = 65536;
const MAX_READ_SIZE = 4000;
const dataIndicator = new Buffer("DATA");

// create one of these to interface with a device
class ADBDevice {
  constructor (connectionType, device) {
    this.connectionType = connectionType;
    if (connectionType === CONNECTION_TYPES.USB) {
      logExceptOnTest("Creating a usb device.");
      // let foundDevice = findAdbDevices();
      // this.serialNumber = device.serialNumber;
      this.device = new USBDevice(device.device, device.deviceInterface);
    } else if (connectionType === CONNECTION_TYPES.TCP) {
      // insert tcp things
    } else {
      // errors yo
      throw new Error("Invalid connection type.");
    }
  }

  // recv a packet from the device and respond with okay so we can recv again
  async recvAndOkay (localId, remoteId) {
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    await this.device._sendMsg(ADB_COMMANDS.CMD_OKAY
                              , localId
                              , remoteId
                              , "");
    return packet;
  }

  // this function calls _send message and then tries to
  // recv an OKAY back from the device, use when sending
  // lots of packets to the device to instead of straight
  // _sendMsg and _recvMsg calls
  async sendAndOkay (cmd, arg1, arg2, payload) {
    await this.device._sendMsg(cmd, arg1, arg2, payload);
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    if (packet.command !== ADB_COMMANDS.CMD_OKAY) {
      // TODO: fix this so the error message returns the command name, not a number
      throw new Error(`sendAndOkay did not recv CMD_OKAY back from device: ${packet.command.toString()}`, -1);
    }
    return packet;
  }

  // ask the device for a file's stats
  async stat (remotePath, localId, remoteId) {
    // tell the device we're going to want stats about a file
    let statBuffer = new Buffer(8);
    statBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_STAT, 0);
    statBuffer.writeUInt32LE(remotePath.length, 4);
    let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                       , localId
                                       , remoteId
                                       , statBuffer);
    // investigate why this needs be sent twice in order to get past
    // this step in the flow
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                    , localId
                                    , remoteId
                                    , remotePath);
    packet = await this.recvAndOkay(localId, remoteId);
    return packet;
  }

  async fileLoop (filePath, fileStats, devicePath, localId, remoteId) {
    let sendBuffer = new Buffer(`${devicePath},${fileStats.mode}`);
    let fd = await fs.open(filePath, 'r');
    let remaining = fileStats.size;
    let currentPosition = 0;
    let appendDataSize = true;
    // DATA<size> can only be 64k or less
    let dataAmount = remaining > MAX_DATA_SIZE ? MAX_DATA_SIZE : remaining;
    while (remaining > 0) {
      // if we need to send a DATA<size> in this next packet
      if (appendDataSize) {
        let sizeBuffer = new Buffer(4);
        sizeBuffer.writeUInt32LE(dataAmount);
        sendBuffer = Buffer.concat([sendBuffer, dataIndicator, sizeBuffer]);
        appendDataSize = false;
      }
      let amountToRead = null;
      // amountToRead should either be MAX_READ_SIZE, the remaining amount of dataAmount,
      // or MAX_READ_SIZE - sendBuffer.length which is a case where we've got some data
      // from a previous DATA<size> in sendBuffer and there is still data in the file
      // meaning we need to insert another DATA<size> in the current packet we're
      // building plus more file data
      if (sendBuffer.length === 0) {
        amountToRead = dataAmount > MAX_READ_SIZE ? MAX_READ_SIZE : dataAmount;
      } else {
        amountToRead = remaining > MAX_READ_SIZE ? MAX_READ_SIZE - sendBuffer.length : remaining;
      }
      let readBuffer = new Buffer(amountToRead);
      await fs.read(fd, readBuffer, 0, amountToRead, currentPosition);
      sendBuffer = Buffer.concat([sendBuffer, readBuffer]);
      remaining -= amountToRead;
      dataAmount -= amountToRead;
      currentPosition += amountToRead;
      // if dataAmount is 0 and there is still some data in the file that means
      // we're in the case where we need to write another DATA<size> + some file data
      // to sendBuffer, so we continue the loop in order to keep sendBuffer's current
      // contents, and to write to it again before we send the packet out to the device
      if (dataAmount === 0  & remaining !== 0) {
        appendDataSize = true;
        dataAmount = remaining > MAX_DATA_SIZE ? MAX_DATA_SIZE : remaining;
        continue;
      }
      if (remaining === 0) {
        logExceptOnTest("sending done");
        let doneBuffer = new Buffer("DONE");
        let mTimeBuffer = new Buffer(4);
        mTimeBuffer.writeUInt32LE(fileStats.mtime.getTime() / 1000, 0);
        sendBuffer = Buffer.concat([sendBuffer, doneBuffer, mTimeBuffer]);
      }
      let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                         , localId
                                         , remoteId
                                         , sendBuffer);
      if (packet.data) {
        logExceptOnTest("packet data: ", packet.data.toString());
      }
      sendBuffer = new Buffer("");
    }
    logExceptOnTest("fileLoop finished");
  }

  // function to send a file to the device, part of _push flow gets some stats
  // about the file, calls fileLoop, and then finishes off the push flow and
  // closes the stream
  async sendFile (filePath, destination, localId, remoteId) {
    let fileName = getFileName(filePath);
    // path where the file will end up on the device, including the file name
    let devicePath = `${destination}/${fileName}`;
    let stats = await fs.stat(filePath);
    // await this.device._fileLoop(filePath, stats, devicePath, localId, remoteId);
    await this.fileLoop(filePath, stats, devicePath, localId, remoteId);
    logExceptOnTest("File sending is finished, cleanup time");
    // the device is going to send us a WRTE containing an OKAY as the data
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    // now we send it the same thing back
    await this.device._sendMsg(ADB_COMMANDS.CMD_WRTE
                              , localId
                              , remoteId
                              , ADB_COMMANDS.CMD_OKAY);
    // send QUIT and get an OKAY back
    await this.device._sendMsg(ADB_COMMANDS.CMD_WRTE
                              , localId
                              , remoteId
                              , ADB_SUBCOMMANDS.CMD_QUIT);
    packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    // send CLSE and then recv CLSE back from the device
    await this.close(localId, remoteId);
  }

  // recv chunks of a file from the device until we read DONE at the end of a msg
  async recvFile(localId, remoteId) {
    let run = true;
    let data = new Buffer("");
    do {
      let packet = await this.recvAndOkay(localId, remoteId);
      let done = packet.data.readUInt32LE(packet.data.length - 8);
      if (done === ADB_SUBCOMMANDS.CMD_DONE) {
        run = false;
      }
      if (data !== null) {
        data = Buffer.concat([data, packet.data]);
      }
    } while (run === true);
    return data;
  }

  async recvList(localId, remoteId) {
    const props = [
      'cmd',
      'mode',
      'size',
      'modified',
      'length',
      'filename'
    ];
    const files = [];
    let file = {};
    let i = 0;
    let run = true;

    do {
      let packet = await this.recvAndOkay(localId, remoteId);
      let pos = 0;
      do {
        if (props[i] === 'filename') {
          file.filename = packet.data.slice(pos, pos + file.length).toString();
          pos += file.length;
          delete file.length;
          files.push(file);
          file = {};
        } else {
          let chunk = packet.data.readUInt32LE(pos);
          switch (props[i]) {
            case 'cmd':
              if (chunk === ADB_SUBCOMMANDS.CMD_DONE) {
                run = false;
                pos = Infinity;
              }
              break;
            case 'modified':
              file.modified = new Date(chunk * 1000);
              break;
            default:
              file[props[i]] = chunk;
          }
          pos += 4;
        }
        i = (i + 1) % props.length;
      } while (pos < packet.data.length);
    } while (run === true);
    return files;
  }

  // runs ADB push to push a file to the device
  async push (source, destination) {
    let syncBuf = new Buffer("sync:.");
    // open a SYNC stream on the device for pushing the file
    let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                       , 12345
                                       , 0
                                       , syncBuf);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    await this.stat(destination, localId, remoteId);
    let devicePath = `${destination}/${getFileName(source)}`;
    let sendBuffer = new Buffer(8);
    sendBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_SEND, 0);
    sendBuffer.writeUInt32LE(devicePath.length + 6, 4);
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                   , localId
                                   , remoteId
                                   , sendBuffer);
    await this.sendFile(source, destination, localId, remoteId);
  }

  // runs ADB push to push a file to the device
  async list (remotePath) {
    let syncBuf = new Buffer("sync:.");
    // open a SYNC stream on the device for pushing the file
    let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                       , 12345
                                       , 0
                                       , syncBuf);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    packet = await this.stat(remotePath, localId, remoteId);
    let fileType = packet.data.readUInt32LE(4) >>> 13;
    if (fileType === FILE_TYPES.FILE || fileType === 0) { // remotePath is a file or doesn't exist
      logExceptOnTest("The remote path does not exist or is a file, not a directory.");
      await this.close(localId, remoteId);
      return -1;
    }
    let listBuffer = new Buffer(8);
    listBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_LIST, 0);
    listBuffer.writeUInt32LE(remotePath.length, 4);
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                   , localId
                                   , remoteId
                                   , listBuffer);
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                   , localId
                                   , remoteId
                                   , remotePath);
    logExceptOnTest("sent remote path to list");
    // recv the file data from the device
    let files = await this.recvList(localId, remoteId);
    return files;
  }

  // runs ADB pull to pull a file from the device to the local machine
  async pull (source, destination) {
    let syncBuf = new Buffer("sync:.");
    // open a SYNC stream on the device for pulling a file from the device
    let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                       , 12345
                                       , 0
                                       , syncBuf);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devnices local id
    let remoteId = packet.arg1;
    // tell the device we're going to want stats about a file
    packet = await this.stat(source, localId, remoteId);
    let mode = packet.data.readUInt32LE(4);
    if (mode === 0) { // file doesn't exist
      logExceptOnTest("The file you're trying to pull doesn't exist.");
      await this.close(localId, remoteId);
      return -1;
    }
    let fileSize = packet.data.readUInt32LE(8);
    // tell the device we want to recv the file
    let recvBuffer = new Buffer(8);
    recvBuffer.writeUInt32LE(ADB_SUBCOMMANDS.CMD_RECV, 0);
    recvBuffer.writeUInt32LE(source.length, 4);
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                   , localId
                                   , remoteId
                                   , recvBuffer);
    // send the path to the file want to pull again
    packet = await this.sendAndOkay(ADB_COMMANDS.CMD_WRTE
                                   , localId
                                   , remoteId
                                   , source);
    logExceptOnTest("sent final source");
    // recv the file data from the device
    let rawData = await this.recvFile(localId, remoteId);
    // pull the file data out (there's data related to the protocol in rawData)
    let fileData = parseFileData(rawData);
    // write data to a local file
    let writeAsync = Promise.promisify(fs.writeFile);
    await writeAsync(destination, fileData); // do we need to await this line?
    return fileSize;
  }

  // install an APK on the device, uses push and shell
  async install (apkSource) {
    await this.push(apkSource, installLocation);
    let fileName = getFileName(apkSource);
    logExceptOnTest("filename: ", fileName);
    let shellString = `pm install ${installLocation}${fileName}`;
    logExceptOnTest("shellString: ", shellString);
    await this.shell(shellString);
  }

  async uninstall (packageName) {
    let shellString = `${uninstallString} ${packageName}`;
    return await this.shell(shellString);
  }

  // runs an ADB shell command on the device, such as shell ls -al
  async shell (commandString, print) {
    let shellString = `shell:${commandString}.`;
    let packet = await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                                       , 12345
                                       , 0
                                       , shellString);
    // this is our local id, the devices remote id
    let localId = packet.arg2;
    // this is our remote id, the devices local id
    let remoteId = packet.arg1;
    let command = packet.command;
    let output = "";
    if (command !== ADB_COMMANDS.CMD_OKAY) {
      throw new Error("OPEN response was not OKAY");
    }
    // we want to read packets from the device unti we get one with a command
    // of CLSE, which signals the end of the transmission for the shell command
    do {
      packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      command = packet.command;
      if (command === ADB_COMMANDS.CMD_WRTE) {
        if (print) { // the data we recv back from the device will already contain newlines
          process.stdout.write(packet.data.toString());
        } else {
          output += packet.data.toString();
        }
        // send and okay so the device knows it can send us more data
        await this.device._sendMsg(ADB_COMMANDS.CMD_OKAY
                                  , localId
                                  , remoteId
                                  , "");
      }
    } while (command !== ADB_COMMANDS.CMD_CLSE);
    logExceptOnTest("Shell read loop has finished");
    // we got a CLSE, now we send a CLSE to close off the connection
    await this.device._sendMsg(ADB_COMMANDS.CMD_CLSE
                              , localId
                              , remoteId
                              , "");
    logExceptOnTest("Sent CLSE.");
    return output;
  }

  // pretty simple, just reboots the device via it's own OPEN string
  async reboot () {
    let rebootBuffer = new Buffer("reboot:.");
    await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                          , 12345
                          , 0
                          , rebootBuffer);
  }

  // open a stream to a certain path on the device
  // as an example, shell: opens a shell into the device
  async open (command) {
    let output = null;
    logExceptOnTest("open");
    switch (command.type) {
      case "shell":
        output = await this.shell(command.string, command.print);
        break;
      case "push":
        try {
          await fs.stat(command.source);
        } catch (err) {
          logExceptOnTest("The file you're trying to push doesn't exist.");
          output = -1;
          break;
        }
        await this.push(command.source, command.destination);
        break;
      case "pull":
        output = await this.pull(command.source, command.destination);
        break;
      case "list":
        output = await this.list(command.remotePath);
        break;
      case "install":
        await this.install(command.source);
        break;
      case "uninstall":
        output = await this.uninstall(command.packageName);
        break;
      case "reboot":
        await this.reboot();
        break;
      default:
        // TODO: change this to throw an error, test that the error is thrown?
        logExceptOnTest("Sorry, that command type isn't supported yet: ", command.type);
        break;
    }
    // console.log("returning from open: ", output);
    return output;
  }

  // calls claim device (if usb) and then performs the ADB usb handshake
  // returns a promise, will have the error value if an error is thrown
  async initConnection () {
    if (this.connectionType === CONNECTION_TYPES.USB) {
      this.device.claimDevice();
      logExceptOnTest("claimed device");
    }
    logExceptOnTest("Trying to establish a connection with the device");
    await this.device._sendMsg(ADB_COMMANDS.CMD_CNXN
                             , CONNECT_VALUES.CONNECT_VERSION
                             , CONNECT_VALUES.CONNECT_MAXDATA
                             , CONNECT_VALUES.CONNECT_PAYLOAD);
    logExceptOnTest("Sent connect message.");
  }

  // after we send a connect message we should recv AUTH back from the device
  async waitForAuth () {
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    if (packet.command === ADB_COMMANDS.CMD_AUTH) {
      return packet;
    }
    return false;
  }

  // see if the device will accept the token from it's AUTH packet
  // signed with our private key
  async sendSignedToken (token) {
    let signedToken = signLib.sign(new Buffer(privateKeyPath + "\0"), token);
    // see if the device will accept our signed token
    await this.device._sendMsg(ADB_COMMANDS.CMD_AUTH, 2, 0, signedToken);
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    return packet.command === ADB_COMMANDS.CMD_CNXN;
  }

  // device didn't accept signed token, send it our public key
  async sendPublicKey () {
    let publicKeyBuf = new Buffer(publicKeyString.length + 1);
    publicKeyString.copy(publicKeyBuf);
    publicKeyBuf[-1] = 0;
    await this.device._sendMsg(ADB_COMMANDS.CMD_AUTH, 3, 0, publicKeyBuf);
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    logExceptOnTest("Sent auth message and public key");
    return packet.command === ADB_COMMANDS.CMD_CNXN;
  }

  // send a close to the device and recv an clse back from it
  // this should only be necessary if we open a stream to the device
  async close (localId, remoteId) {
    await this.device._sendMsg(ADB_COMMANDS.CMD_CLSE
                             , localId
                             , remoteId
                             , "");
    // it seems like sometimes we read an OKAY here
    while (1) {
      let packet = await this.device._recvMsg(localId, remoteId);
      if (packet.command === ADB_COMMANDS.CMD_CLSE) {
        return;
      } else {
        continue;
      }
    }
  }

  async closeConnection () {
    await this.device.releaseDevice();
  }
}

export default ADBDevice;
