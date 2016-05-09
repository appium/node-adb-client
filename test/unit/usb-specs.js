import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { verify, withMocks } from 'appium-test-support';
import USBDevice from '../../lib/usb-device';
import { CONNECT_VALUES
       , ADB_COMMANDS
       , LIBUSB_VALUES } from '../../lib/constants';
import { generateMessage } from '../../lib/helpers';

const LIBUSB_TRANSFER_TYPE_BULK = LIBUSB_VALUES.LIBUSB_TRANSFER_TYPE_BULK;

chai.should();
chai.use(chaiAsPromised);

describe('usb-device unit tests', () => {
  let inputEndpoint = { transferAsync: () => { return "nothing"; } };
  let outputEndpoint = { transferAsync: () => { return "nothing"; } };
  let usbDevice = new USBDevice();
  beforeEach(() => {
    usbDevice.inputEndpoint = inputEndpoint;
    usbDevice.outputEndpoint = outputEndpoint;
  });
  describe('setEndpoints', () => {
    it('should set inputEndpoint to endpoints[0] if endpoints[0].direction is in', () => {
      let endpoints = [ { direction: 'in', transferType: null }
                      , { direction: 'out', transferType: null }];
      usbDevice.setEndpoints(endpoints);
      usbDevice.inputEndpoint.direction.should.equal(endpoints[0].direction);
      usbDevice.inputEndpoint.transferType.should.equal(LIBUSB_TRANSFER_TYPE_BULK);
    });
    it('should set inputEndpoint to endpoints[1] if endpoints[1].direction is in', () => {
      let endpoints = [ { direction: 'out', transferType: null }
                      , { direction: 'in', transferType: null }];
      usbDevice.setEndpoints(endpoints);
      usbDevice.inputEndpoint.direction.should.equal(endpoints[1].direction);
      usbDevice.inputEndpoint.transferType.should.equal(LIBUSB_TRANSFER_TYPE_BULK);
    });
  });
  describe('_sendMsg', withMocks({ usbDevice, outputEndpoint}, (mocks) => {
    it('should call outputEndpoint.transferAsync once if no payload', async () => {
      mocks.outputEndpoint.expects('transferAsync')
        .once()
        .returns();
      await usbDevice._sendMsg(ADB_COMMANDS.CMD_OKAY, 12345, 12345, "");
      verify(mocks);
    });
    it('should call outputEndpoint.transferAsync twice if there is a data payload', async () => {
      mocks.outputEndpoint.expects('transferAsync')
        .twice()
        .returns();
      await usbDevice._sendMsg(ADB_COMMANDS.CMD_OKAY, 12345, 12345, "test");
      verify(mocks);
    });
  }));
  describe('_recvMsg', withMocks({ usbDevice, inputEndpoint }, (mocks) => {
    it('should return a packet with the correct command that came in on the wire', async () => {
      let fakePacket = generateMessage(ADB_COMMANDS.CMD_OKAY, 12345, 12345, "");
      mocks.inputEndpoint.expects('transferAsync')
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(fakePacket);
      let packet = await usbDevice._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      packet.command.should.equal(ADB_COMMANDS.CMD_OKAY);
    });
    it('should return a packet with the dataLen 0 when there was no data payload', async () => {
      // set up the buffer, we don't really care about the crc at byte 16-19
      let initialBuffer = new Buffer(24);
      initialBuffer.writeUInt32LE(ADB_COMMANDS.CMD_OKAY, 0);
      initialBuffer.writeUInt32LE(12345, 4);
      initialBuffer.writeUInt32LE(12345, 8);
      initialBuffer.writeUInt32LE(0, 12);

      mocks.inputEndpoint.expects('transferAsync')
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(initialBuffer);
      mocks.usbDevice.expects('getPacketData')
        .never();
      let packet = await usbDevice._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      packet.dataLen.should.equal(0);
      verify(mocks);
    });
    it('should return a packet with the correct dataLen when there was a data payload', async () => {
      // set up the buffer, we don't really care about the crc at byte 16-19
      let payloadSize = 4;
      let payloadBuffer = new Buffer("test");
      let initialBuffer = new Buffer(24);
      initialBuffer.writeUInt32LE(ADB_COMMANDS.CMD_OKAY, 0);
      initialBuffer.writeUInt32LE(12345, 4);
      initialBuffer.writeUInt32LE(12345, 8);
      initialBuffer.writeUInt32LE(payloadSize, 12);

      mocks.inputEndpoint.expects('transferAsync')
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(initialBuffer);
      mocks.usbDevice.expects('getPacketData')
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA, payloadSize)
        .returns(payloadBuffer);
      let packet = await usbDevice._recvMsg(CONNECT_VALUES.CONNECT_MAXDATA);
      packet.data.length.should.equal(packet.dataLen);
      verify(mocks);
    });
  }));
  describe('getPacketData', withMocks({ usbDevice, inputEndpoint }, (mocks) => {
    it('should only call transferAsync once if dataLen < maxdata (4096)', async () => {
      let dataLen = 4000;
      let testBuffer = new Buffer(dataLen);
      mocks.inputEndpoint.expects('transferAsync')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(testBuffer);
      let packetData = await usbDevice.getPacketData(CONNECT_VALUES.CONNECT_MAXDATA, dataLen);
      packetData.length.should.equal(dataLen);
      verify(mocks);
    });
    it('should call transferAsync at least twice if dataLen > maxdata (4096)', async () => {
      let dataLen = 8000;
      // let testBuffer = new Buffer(dataLen);
      mocks.inputEndpoint.expects('transferAsync')
        .twice()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .onFirstCall()
        .returns(new Buffer(CONNECT_VALUES.CONNECT_MAXDATA))
        .onSecondCall()
        .returns(new Buffer(dataLen - CONNECT_VALUES.CONNECT_MAXDATA));
      let packetData = await usbDevice.getPacketData(CONNECT_VALUES.CONNECT_MAXDATA, dataLen);
      packetData.length.should.equal(dataLen);
      verify(mocks);
    });
  }));
});
