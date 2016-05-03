// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import proxyquire from 'proxyquire';
import { verify, withMocks } from 'appium-test-support';
import { ADB_VALUES
       , LIBUSB_VALUES
       , CONNECTION_TYPES } from '../../lib/constants';
import ADBDevice from '../../lib/adb-device';
import USBDevice from '../../lib/usb-device';

process.env.NODE_ENV = 'test';

// for proxyquire
let usbStub = { '@noCallThru': true };
let signLibStub = { '@noCallThru': true };
let adbDeviceStub = proxyquire('../../lib/adb-device', { 'signLib': signLibStub });
let adb = proxyquire('../../adb', { 'usb': usbStub, 'adb-device': adbDeviceStub });
const LIBUSB_ENDPOINT_IN = LIBUSB_VALUES.LIBUSB_ENDPOINT_IN
   , LIBUSB_ENDPOINT_OUT = LIBUSB_VALUES.LIBUSB_ENDPOINT_OUT;

chai.should();
let expect = chai.expect;
chai.use(chaiAsPromised);

describe('static functions', () => {
  // fake device setup
  let endpoints = [LIBUSB_ENDPOINT_IN, LIBUSB_ENDPOINT_OUT ];
  let deviceDescriptor = { idVendor: null
                        , iSerialNumber: "12345" };
  let interfaceDescriptor = { bInterfaceClass: ADB_VALUES.ADB_CLASS
                           , bInterfaceSubClass: ADB_VALUES.ADB_SUBCLASS
                           , bInterfaceProtocol: ADB_VALUES.ADB_PROTOCOL };
  let iface = { descriptor: interfaceDescriptor
             , endpoints: endpoints };
  let device = { interfaces: [iface]
               , deviceDescriptor: deviceDescriptor
               , open: () => { return "nothing"; } };
  describe('getAdbInterface', () => {
    it('should return null if the interface vendor is not one we recognze', () => {
      expect(adb.getAdbInterface(device)).to.be.a('null');
    });
    it('should return an interface if there is one for ADB comms', () => {
      deviceDescriptor.idVendor = 0x04e8; // samsung
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
  describe('findAdbDevices', withMocks({ usbStub}, (mocks) => {
    usbStub.getDeviceList = () => { return "nothing"; };
    it('should throw an error if there are no usb devices', () => {
      mocks.usbStub.expects('getDeviceList')
        .once()
        .returns([]);
      () => {
        adb.findAdbDevices();
      }.should.throw("No USB devices found.");
      mocks.usbStub.verify();
    });
    it('should throw an error if none of the usb devices have ADB interfaces', () => {
      mocks.usbStub.expects('getDeviceList')
        .once()
        .returns([device]);
      () => {
        adb.findAdbDevices();
      }.should.throw("No ADB devices found.");
      mocks.usbStub.verify();
    });
    it('should return an object if there was a device with an adb interface', () => {
      device.interfaces = [iface];
      iface.descriptor.bInterfaceClass = 255;
      mocks.usbStub.expects('getDeviceList')
        .once()
        .returns([device]);
      expect(adb.findAdbDevices()).to.not.be.empty;
      mocks.usbStub.verify();
    });
  }));
});

describe('adb', () => {
  let usbDevice = new USBDevice();
  let adbObj = new adb(CONNECTION_TYPES.USB, usbDevice); // state: NOT_CONNECTED
  let adbDevice = new ADBDevice(CONNECTION_TYPES.USB, usbDevice);
  adbObj.device = adbDevice;
  const NOT_CONNECTED = 0;
  const CONNECTED = 4;

  describe('runCommand', withMocks({ adbDevice }, (mocks) => {
    it('should reject with an error if state is not connected', async () => {
      let command = "test";
      mocks.adbDevice.expects('open')
        .never();
      await adbObj.runCommand(command).should.be.rejected;
      verify(mocks);
    });
    it('should resolve if state is connected', async () => {
      let command = "test";
      adbObj.state = CONNECTED;
      mocks.adbDevice.expects('open')
        .once()
        .withExactArgs(command);
      await adbObj.runCommand(command).should.be.resolved;
      verify(mocks);
    });
    it('should return some output if device.open returned some output', async () => {
      const CONNECTED = 4;
      let command = "test";
      adbObj.state = CONNECTED;
      mocks.adbDevice.expects('open')
        .once()
        .withExactArgs(command)
        .returns(command);
      let output = await adbObj.runCommand(command);
      output.should.equal(command);
      verify(mocks);
    });
    it('should return undefined if device.open returned undefined', async () => {
      const CONNECTED = 4;
      let command = "test";
      adbObj.state = CONNECTED;
      mocks.adbDevice.expects('open')
        .once()
        .withExactArgs(command)
        .returns(undefined);
      let output = await adbObj.runCommand(command);
      expect(output).to.be.an('undefined');
      verify(mocks);
    });
  }));
  describe('initConnection', withMocks({ adbDevice }, (mocks) => {
    it('should call device.initConnection if state is NOT_CONNECTED', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .once();
      await adbObj.initConnection();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should not call device.initConnection if state is CONNECTED', async () => {
      adbObj.state = CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .never();
      await adbObj.initConnection();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
  }));
  describe('closeConnection', withMocks({ adbDevice }, (mocks) => {
    it('should call device.closeConnection if state is CONNECTED', async () => {
      adbObj.state = CONNECTED;
      mocks.adbDevice.expects('closeConnection')
        .once();
      await adbObj.closeConnection();
      adbObj.state.should.equal(NOT_CONNECTED);
      verify(mocks);
    });
    it('should not call device.closeConnection if state is NOT_CONNECTED', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('closeConnection')
        .never();
      await adbObj.closeConnection();
      adbObj.state.should.equal(NOT_CONNECTED);
      verify(mocks);
    });
  }));
  describe('connect', withMocks({ adbDevice }, (mocks) => {
    it('should call device.initConnection twice if first waitForAuth returns false', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .twice();
      mocks.adbDevice.expects('waitForAuth')
        .twice()
        .onFirstCall()
        .returns(false)
        .onSecondCall()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .once()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should call device.sendPublicKey if device.sendSignedToken returns false', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .once();
      mocks.adbDevice.expects('waitForAuth')
        .once()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .once()
        .returns(false);
      mocks.adbDevice.expects('sendPublicKey')
        .once()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should call device.sendPublicKey twice if device.sendSignedToken returns false', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .twice();
      mocks.adbDevice.expects('waitForAuth')
        .twice()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .twice()
        .returns(false);
      mocks.adbDevice.expects('sendPublicKey')
        .twice()
        .onFirstCall()
        .returns(false)
        .onSecondCall()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should restart the entire loop if waitForAuth times out', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .twice();
      mocks.adbDevice.expects('waitForAuth')
        .twice()
        .onFirstCall()
        .throws({errno: 2})
        .onSecondCall()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .once()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should restart the entire loop if sendSignedToken times out', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .twice();
      mocks.adbDevice.expects('waitForAuth')
        .twice()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .twice()
        .onFirstCall()
        .throws({errno: 2})
        .onSecondCall()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
    it('should restart the entire loop if sendPublicKey times out', async () => {
      adbObj.state = NOT_CONNECTED;
      mocks.adbDevice.expects('initConnection')
        .twice();
      mocks.adbDevice.expects('waitForAuth')
        .twice()
        .returns(true);
      mocks.adbDevice.expects('sendSignedToken')
        .twice()
        .returns(false);
      mocks.adbDevice.expects('sendPublicKey')
        .twice()
        .onFirstCall()
        .throws({errno: 2})
        .onSecondCall()
        .returns(true);
      await adbObj.connect();
      adbObj.state.should.equal(CONNECTED);
      verify(mocks);
    });
  }));
});


