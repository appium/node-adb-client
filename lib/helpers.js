import { CONNECTION_TYPES } from './constants';
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
  let payloadBuffer = !Buffer.isBuffer(payload) ? new Buffer(payload)
                      : payload;

  let msgLength = payload !== null ? ADB_HEADER_LENGTH + payloadBuffer.length
                  : ADB_HEADER_LENGTH;

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
    console.log("writing data payload to packet");
    payloadBuffer.copy(message, 24);
  }
  return message;
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

export { generateMessage, packetFromBuffer };