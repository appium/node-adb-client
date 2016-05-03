// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import { generateMessage
       , packetFromBuffer
       , getFileName
       , parseFileData } from '../../lib/helpers';
import { ADB_COMMANDS, CONNECTION_TYPES } from '../../lib/constants';

process.env.NODE_ENV = 'test';

chai.should();
chai.use(chaiAsPromised);

describe('helpers', () => {
  describe('generateMessage', () => {
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
  describe('packtFromBuffer', () => {
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
  describe('getFileName', () => {
    it('should return a string with no /\'s', () => {
      let filePath = "a/test/path";
      let fileName = getFileName(filePath);
      fileName.should.equal('path');
    });
  });
  describe('parseFileData', () => {
    it('should return a buffer with none of the ADB protocol info', () => {
      // this test is not great, but better than nothing
      // lazy buffer creation
      let oneSize = 512, twoSize = 496;
      let dataIndicator = new Buffer("DATA"), doneIndicator = new Buffer("DONE");
      let dataOne = new Buffer(oneSize).fill('a'), dataTwo = new Buffer(twoSize).fill('b');
      let sizeOne = new Buffer(4), sizeTwo = new Buffer(4);
      sizeOne.writeUInt32LE(oneSize);
      sizeTwo.writeUInt32LE(twoSize);
      let fakeBuffer = new Buffer("");
      // concat them all
      fakeBuffer = Buffer.concat([dataIndicator
                                , sizeOne
                                , dataOne
                                , dataIndicator
                                , sizeTwo
                                , dataTwo
                                , doneIndicator]);
      let parsedData = parseFileData(fakeBuffer);
      fakeBuffer.length.should.be.above(parsedData.length);
      parsedData.toString().indexOf('DATA').should.equal(-1);
      parsedData.toString().indexOf('DONE').should.equal(-1);
    });
  });
});
