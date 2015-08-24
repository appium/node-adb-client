// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import proxyquire from 'proxyquire';

process.env.NODE_ENV = 'test';

let usbStub = { '@noCallThru': true };
let helpers = proxyquire('../../lib/helpers', {usb: usbStub });
let generateMessage = helpers.generateMessage;
let packetFromBuffer = helpers.packetFromBuffer;
let getAdbInterface = helpers.getAdbInterface;
let findAdbDevices = helpers.findAdbDevices;
let selectBySerialNumber = helpers.selectBySerialNumber;

import { ADB_COMMANDS, CONNECTION_TYPES, ADB_VALUES
       , LIBUSB_VALUES } from '../../lib/constants';
const LIBUSB_ENDPOINT_IN = LIBUSB_VALUES.LIBUSB_ENDPOINT_IN
    , LIBUSB_ENDPOINT_OUT = LIBUSB_VALUES.LIBUSB_ENDPOINT_OUT;

chai.should();
let expect = chai.expect;
chai.use(chaiAsPromised);

// fake device setup
let endpoints = [LIBUSB_ENDPOINT_IN, LIBUSB_ENDPOINT_OUT ];
let deviceDescriptor = { idVendor: 0x04e8 // samsung
                       , iSerialNumber: "12345" };
let interfaceDescriptor = { bInterfaceClass: ADB_VALUES.ADB_CLASS
                          , bInterfaceSubClass: ADB_VALUES.ADB_SUBCLASS
                          , bInterfaceProtocol: ADB_VALUES.ADB_PROTOCOL };
let iface = { descriptor: interfaceDescriptor
            , endpoints: endpoints };
let device = { interfaces: [iface,]
             , deviceDescriptor: deviceDescriptor
             , configDescriptor: {}
             , open: () => { return "nothing"; } };
let adbDevice = { device: device
                , deviceInterface: iface
                , serialNumber: "12345" };
let deviceArray = [adbDevice];

describe('helper function tests', () => {
  describe('generateMessage tests', () => {
    it('should throw error when invalid command is passed', () => {
      () => {
        generateMessage(1, 0, 0, "payload", CONNECTION_TYPES.USB);
      }.should.throw("generateMessage: invalid command type");
    });
    it('should throw error when invalid connection type is passed', () => {
      () => {
        generateMessage(ADB_COMMANDS.CMD_CNXN, 0, 0, "payload", 3);
      }.should.throw("generateMessage: invalid connection type");
    });
    it('should append data payload if connection type is tcp', () => {
      let cnxn = ADB_COMMANDS.CMD_CNXN;
      let tcpMsg = generateMessage(cnxn, 0, 0, "payload", CONNECTION_TYPES.TCP);
      tcpMsg.length.should.not.equal(24);
    });
    it('should not append data payload if connection type is usb', () => {
      let cnxn = ADB_COMMANDS.CMD_CNXN;
      let usbMsg = generateMessage(cnxn, 0, 0, "payload", CONNECTION_TYPES.USB);
      usbMsg.length.should.equal(24);
    });
  });
  describe('packtFromBuffer tests', () => {
    // fake packet buffer
    let payloadBuffer = new Buffer("payload");
    let packetBuffer = new Buffer(30);
    packetBuffer.writeUInt32LE(ADB_COMMANDS.CMD_CNXN, 0);
    packetBuffer.writeUInt32LE(0, 4);
    packetBuffer.writeUInt32LE(0, 8);
    packetBuffer.writeUInt32LE(payloadBuffer.length, 12);
    packetBuffer.writeUInt32LE(0, 16);
    packetBuffer.writeUInt32LE(0, 20);
    packetBuffer.write("payload", 24, 7);
    // copy the data into the packet
    // payloadBuffer.copy(payloadBuffer, 24);
    it('should throw an error if we pass less than 24 bytes of data', () => {
      () => {
        let buf = new Buffer(23);
        packetFromBuffer(buf);
      }.should.throw(Error);
    });
    it('should fill data field if data length was > 0', () => {
      let packet = packetFromBuffer(packetBuffer);
      (typeof packet.data).should.not.equal('undefined');
    });
    it('should not fill the data field if data length was 0', () => {
      // overwrite the dataLen field
      packetBuffer.writeUInt32LE(0, 12);
      let packet = packetFromBuffer(packetBuffer);
      (typeof packet.data).should.equal('undefined');
    });
  });
  describe('getAdbInterface tests', () => {
    it('should return an interface if there is one for ADB comms', () => {
        getAdbInterface(device).should.not.be.null;
    });
    it('should return null if there are interfaces but no ADB interface', () => {
      iface.descriptor.bInterfaceClass = 100;
      expect(getAdbInterface(device)).to.be.a('null');
    });
    it('should return null if there are no interfaces at all', () => {
      device.interfaces = null;
      expect(getAdbInterface(device)).to.be.a('null');
    });
  });
  describe('findAdbDevices tests', () => {
    usbStub.getDeviceList = ()=> { return [device]; };
    it('should return an array with a length of zero', () => {
      expect(findAdbDevices()).to.be.empty;
    });
    it('should return an object if there was a device with an adb interface', () => {
      device.interfaces = [iface];
      iface.descriptor.bInterfaceClass = 255;
      expect(findAdbDevices()).to.not.be.empty;
    });
  });
  describe('selectBySerialNumber tests', () => {
    it('should return a device if a device with that serial number is available', () => {
      expect(selectBySerialNumber(deviceArray, "12345")).should.not.be.null;
    });
    it('should throw an error if there is no device with that serial number', () => {
      () => {
        selectBySerialNumber(deviceArray, "54321");
      }.should.throw();
    });
  });
});
