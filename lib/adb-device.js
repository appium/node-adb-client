import { CONNECTION_TYPES, ADB_COMMANDS, CONNECT_VALUES
       , ADB_KEY } from './constants';
import USBDevice from './usb-device';

import path from 'path';
import fs from 'fs';
let signLib = require('bindings')('binding');

// local constants
const homedir = process.platform === 'win32' ? process.env.HOMEPATH
                                             : process.env.HOME;
const publickeyPath = path.join(homedir, ADB_KEY.PUBLIC_KEY);
const privateKeyPath = path.join(homedir, ADB_KEY.PRIVATE_KEY);
const publicKeyString = fs.readFileSync(publickeyPath);

// create one of these to interface with a device
class ADBDevice {
  constructor (connectionType, device) {
    this.connectionType = connectionType;
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

  async recvAndOkay (localId, remoteId) {
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    await this.device._sendMsg(ADB_COMMANDS.CMD_OKAY
                              , localId
                              , remoteId
                              , "");
    return packet;
  }

  async sendAndOkay (cmd, arg1, arg2, payload) {
    await this.device._sendMsg(cmd, arg1, arg2, payload);
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    if (packet.command !== ADB_COMMANDS.CMD_OKAY) {
      throw new Error("sendAndOkay did not recv CMD_OKAY back from device");
    }
    return packet;
  }

  async shell(commandString) {
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
    if (command !== ADB_COMMANDS.CMD_OKAY) {
      throw new Error("OPEN response was not OKAY");
    }
    // we want to read packets from the device unti we get one with a command
    // of CLSE, which signals the end of the transmission for the shell command
    do {
      console.log("loop");
      // packet = await this.recvAndOkay(CONNECT_VALUES.CONNECT_MAXDATA);
      packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      command = packet.command;
      if (command === ADB_COMMANDS.CMD_WRTE) {
        process.stdout.write(packet.data.toString());
        // send and okay so the device knows it can send us more data
        await this.device._sendMsg(ADB_COMMANDS.CMD_OKAY
                           , localId
                           , remoteId
                           , "");
      }
    } while (command !== ADB_COMMANDS.CMD_CLSE);
    console.log("Shell read loop has finished");
    // we got a CLSE, now we send a CLSE to close off the connection
    await this.device._sendMsg(ADB_COMMANDS.CMD_CLSE
                              , localId
                              , remoteId
                              , "");
    console.log("Sent CLSE.");
  }

  async reboot() {
    let rebootBuffer = new Buffer("reboot:.");
    await this.sendAndOkay(ADB_COMMANDS.CMD_OPEN
                          , 12345
                          , 0
                          , rebootBuffer);
  }

  // open a stream to a certain path on the device
  // as an example, shell: opens a shell into the device
  async open (command) {
    console.log("open");
    switch (command.type) {
      case "shell":
        // await this.device._shell(command.string);
        await this.shell(command.string);
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
        await this.reboot();
        break;
      default:
        console.log("Sorry, that command type isn't supported yet.");
        break;
    }
    // await this.device.openStream(command);
  }

  // handles authentication between our machine and
  // the android device upon initial connection
  async handleAuth (token) {
    let publicKeyBuf = new Buffer(publicKeyString.length + 1);
    publicKeyString.copy(publicKeyBuf);
    publicKeyBuf[-1] = 0;

    let signedToken = signLib.sign(new Buffer(privateKeyPath + "\0"), token);
    // see if the device will accept our signed token
    await this.device._sendMsg(ADB_COMMANDS.CMD_AUTH, 2, 0, signedToken);
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    console.log("Device accepted our signed token? ", packet.command === ADB_COMMANDS.CMD_CNXN);
    // if the signed token wasn't accepted then we'll send our public key
    while (packet.command !== ADB_COMMANDS.CMD_CNXN) {
      await this.device._sendMsg(ADB_COMMANDS.CMD_AUTH, 3, 0, publicKeyBuf);
      packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      console.log("Sent auth message and public key");
    }
    return true;
  }

  // calls claim device (if usb) and then performs the ADB usb handshake
  // returns a promise, will have the error value if an error is thrown
  async initConnection() {
    if (this.connectionType === CONNECTION_TYPES.USB) {
      await this.device.claimDevice();
    }
    console.log("Trying to establish a connection with the device");
    await this.device._sendMsg(ADB_COMMANDS.CMD_CNXN
                             , CONNECT_VALUES.CONNECT_VERSION
                             , CONNECT_VALUES.CONNECT_MAXDATA
                             , CONNECT_VALUES.CONNECT_PAYLOAD);
    console.log("Sent connect message.");
    let packet = await this.device._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
    if (packet.command !== ADB_COMMANDS.CMD_AUTH) {
      throw new Error("CNXN response was not AUTH.");
    }
    let run = true;
    do {
      let auth = await this.handleAuth(packet.data);
      if (auth === true) {
        run = false;
      } else if (auth.errno === 2) { // timeout error
        console.log("Read in handleAuth timed out");
        continue;
      } else {
        throw auth;
      }
    } while (run === true);
    console.log("End of initConnection");
  }

  async closeConnection () {
    await this.device.releaseDevice();
  }
}

export default ADBDevice;
