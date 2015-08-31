let testBuffer = new Buffer(4);
testBuffer.writeUInt32LE(65536);
console.log(testBuffer);
let secondBuffer =  new Buffer("test");
testBuffer = Buffer.concat([testBuffer, secondBuffer]);
console.log("testBuffer: ", testBuffer);
testBuffer = new Buffer("");
console.log("testBuffer: ", testBuffer);
console.log("testBuffer length:", testBuffer.length);