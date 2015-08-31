import { CONNECTION_TYPES, ADB_COMMANDS
       , USB_VENDOR_IDS, ADB_VALUES } from './constants';
import _ from 'underscore';
import usb from 'usb';
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
// node that we don't append the actual data payload to the message
// unless we're on tcp
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
  } else {
    message.writeUInt32LE(0, 12);
    message.writeUInt32LE(0, 16);
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

// return an array of devices that have an adb interface
function findAdbDevices () {
  logExceptOnTest("Trying to find a usb device.");
  let adbDevices = [];
  let usbDevices = usb.getDeviceList();
  let deviceIndex = 0;
  for (let device of usbDevices) {
    let deviceInterface = getAdbInterface(device);
    if (deviceInterface !== null) {
      logExceptOnTest("Found an ADB device.");
      adbDevices.push({device, deviceInterface});
      // device.serialNumber = await getSerialNumber(adbDevices, deviceIndex);
      deviceIndex++;
    }
  }
  return adbDevices;
}

// search through the devices interfaces for an interface that can be used for
// adb communications
function getAdbInterface (device) {
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

// takes a file path (seperated by /'s') and gets the file name from
// the end of the path, returns the file name
function getFileName (path) {
  let splitArray = path.split("/");
  return splitArray[splitArray.length - 1];
}

export { generateMessage, packetFromBuffer, findAdbDevices
       , getAdbInterface, getSerialNumbers, getSerialNumber
       , selectBySerialNumber, getFileName };
