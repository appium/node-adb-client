import USBDevice from './lib/usb-device';

async function start () {
  try{
    let device = USBDevice.findAdbDevice();
    if (device === null) {
      throw new Error("No suitable device was found.");
    }
    await device.connectToDevice();
    console.log("End!");
  } catch(err) {
    console.log("error: ", err.stack);
    throw err;
  }
}

console.log("Start!");
start();
