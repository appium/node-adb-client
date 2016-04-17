// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import proxyquire from 'proxyquire';

process.env.NODE_ENV = 'test';

let usbStub = { '@noCallThru': true };
let signLibStub = { '@noCallThru': true };
// this proxyquire isn't working, gulp build will fail at unit tests
let adbDeviceStub = proxyquire('../../lib/adb-device', { 'signLib': signLibStub });
let adb = proxyquire('../../adb', { 'usb': usbStub, 'adb-device': adbDeviceStub });
import { ADB_VALUES, LIBUSB_VALUES } from '../../lib/constants';
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
let device = { interfaces: [iface]
             , deviceDescriptor: deviceDescriptor
             , open: () => { return "nothing"; } };
// let adbDevice = { device: device
//                 , deviceInterface: iface
//                 , serialNumber: "12345" };
// let deviceArray = [adbDevice];

describe('static function tests', () => {
  describe('getAdbInterface tests', () => {
    it('should return an interface if there is one for ADB comms', () => {
        adb.getAdbInterface(device).should.not.be.null;
    });
    it('should return null if there are interfaces but no ADB interface', () => {
      iface.descriptor.bInterfaceClass = 100;
      expect(adb.getAdbInterface(device)).to.be.a('null');
    });
    it('should return null if there are no interfaces at all', () => {
      device.interfaces = null;
      expect(adb.getAdbInterface(device)).to.be.a('null');
    });
  });
  describe('findAdbDevices tests', () => {
    usbStub.getDeviceList = ()=> { return [device]; };
    it('should return an array with a length of zero', () => {
      expect(adb.findAdbDevices()).to.be.empty;
    });
    it('should return an object if there was a device with an adb interface', () => {
      device.interfaces = [iface];
      iface.descriptor.bInterfaceClass = 255;
      expect(adb.findAdbDevices()).to.not.be.empty;
    });
  });
});