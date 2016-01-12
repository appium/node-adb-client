// transpile:mocha

import { generateMessage, packetFromBuffer } from '../../lib/helpers';
import 'mochawait';

process.env.NODE_ENV = 'test';

import { ADB_COMMANDS, CONNECTION_TYPES } from '../../lib/constants';

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
});
