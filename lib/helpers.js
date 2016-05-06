import { CONNECTION_TYPES, ADB_COMMANDS, ADB_SUBCOMMANDS } from './constants';
import _ from 'underscore';
// import usb from 'usb';
import Promise from 'bluebird';
const ADB_HEADER_LENGTH = 24;

function crc (buf) {
  if (!buf) return 0;
  let crcResult = 0;
  // this loop doesn't want to be a let item of object loop
  for (let i = 0; i < buf.length; i++) {
    crcResult = (crcResult + buf[i]) & 0xFFFFFFFF;
  }
  return crcResult;
}

// generates a message according to the ADB packet specifications
// noTte that we don't append the actual data payload to the message
// unless we're on tcp, and if you want to pass no payload use ""
function generateMessage (cmd, arg1, arg2, payload, connectionType) {
  // default connectionType to usb since tha's what we expect
  // the connection to be most of the time
  connectionType = typeof connectionType !== 'undefined' ? connectionType
                                                         : CONNECTION_TYPES.USB;
  // cmd needs to be an ADB command
  if (_.contains(_.values(ADB_COMMANDS), cmd) === false) {
    throw new Error("generateMessage: invalid command type");
  }
  // connection type can only be USB or TCP
  if (_.contains(_.values(CONNECTION_TYPES), connectionType) === false) {
    throw new Error("generateMessage: invalid connection type");
  }
  if (_.isNumber(payload)) {
    payload = payload.toString();
  }

  let payloadBuffer = !Buffer.isBuffer(payload) ? new Buffer(payload)
                                                : payload;

  let msgLength = ADB_HEADER_LENGTH;
  // only allocate space for data payload if we're going to fill that field
  if (connectionType === CONNECTION_TYPES.TCP) {
    msgLength = msgLength + payloadBuffer.length;
  }

  let message = new Buffer(msgLength);
  message.writeUInt32LE(cmd, 0);
  message.writeUInt32LE(arg1, 4);
  message.writeUInt32LE(arg2, 8);

  if (payload !== null) {
    message.writeUInt32LE(payloadBuffer.length, 12);
    message.writeUInt32LE(crc(payloadBuffer), 16);
  }
  let magic = 0xFFFFFFFF - cmd;
  message.writeUInt32LE(magic, 20);
  //connection type TCP
  if (connectionType === CONNECTION_TYPES.TCP) {
    payloadBuffer.copy(message, 24);
  }
  return message;
}

// block console logging when tests are being run
function logExceptOnTest (string) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(string);
  }
}

// returns the devices serial number
async function getSerialNumber (device) {
  let deviceDescriptor = device.deviceDescriptor;
  let getStringDescriptorAsync = Promise.promisify(device.getStringDescriptor, device);
  let serialNumber = await getStringDescriptorAsync(deviceDescriptor.iSerialNumber);
  return serialNumber;
}

async function getSerialNumbers (devices) {
  for (let device of devices) {
    let currentDevice = device.device;
    device.serialNumber = await getSerialNumber(currentDevice);
  }
}

// select a device from the list of available devices by serial number
function selectBySerialNumber (devices, serialNumber) {
  for (let device of devices) {
    if (serialNumber === device.serialNumber) {
      return device;
    }
  }
  throw new Error("No device available with the serial number: ", serialNumber);
}


// takes a buffer from an inputEndpoint read and
// creates the packet structure from the data
function packetFromBuffer (buf) {
  //set the fields we are guaranteed to have
  let packet = {
    "command":  buf.readUInt32LE(0)
  , "arg1":     buf.readUInt32LE(4)
  , "arg2":     buf.readUInt32LE(8)
  , "dataLen":  buf.readUInt32LE(12)
  , "dataCrc":  buf.readUInt32LE(16)
  , "magic":    buf.readUInt32LE(20)
  };
  if (packet.dataLen > 0) {
    packet.data = buf.slice(24, (24 + packet.dataLen));
  }
  return packet;
}

// takes a file path (seperated by /'s') and gets the file name from
// the end of the path, returns the file name
function getFileName (path) {
  let splitArray = path.split("/");
  return splitArray[splitArray.length - 1];
}

// copy the actual file data out of the mess of ADB protocol information
function parseFileData (rawData) {
  let currentPosition = 0;
  let fileData = new Buffer("");
  while (true) {
    // get the length (DATA<length>) so we know how much to copy
    let length = rawData.readUInt32LE(currentPosition + 4);
    currentPosition += 8;
    let chunk = new Buffer(length);
    rawData.copy(chunk, 0, currentPosition, currentPosition + length);
    currentPosition += length;
    fileData = Buffer.concat([fileData, chunk]);
    if (rawData.readUInt32LE(currentPosition) === ADB_SUBCOMMANDS.CMD_DONE) {
      break;
    }
  }
  return fileData;
}

export { generateMessage, packetFromBuffer, getSerialNumbers
       , getSerialNumber, selectBySerialNumber, getFileName
       , parseFileData, logExceptOnTest };
