var ADB = require('./build/adb');
var CONNECTION_TYPES = require('./build/lib/constants').CONNECTION_TYPES;

console.log("Starting.");
var device;

ADB.findAdbDevices().then(function (availableDevices) {
  if (availableDevices.length === 0) return;
  device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
  return device.connect();
}).then(function () {
  console.log("connected");
  var command = {
    type:   "list"
  , remotePath: "sdcard"
  };
  return device.runCommand(command);
}).then(function (output) {
  console.log(output);
  return device.closeConnection();
}).then(function () {
  console.log('closed');
}).catch(function (err) {
  console.log(err);
});
