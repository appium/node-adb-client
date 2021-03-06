// transpile:mocha

import ADB from "../../adb";
import path from 'path';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { fs } from 'appium-support';
import { CONNECTION_TYPES, FILE_TYPES } from '../../lib/constants';
import { sleep } from 'asyncbox';

process.env.NODE_ENV = 'test';

chai.use(chaiAsPromised);
chai.should();

// these test require a device connected via usb
describe('adb-e2e', () => {
  let device = null;
  let availableDevices = null;
  const packageName = "com.example.android.contactmanager";
  const activityName = ".ContactManager";
  before(async () => {
    availableDevices = await ADB.findAdbDevices();
    // just select the first device
    device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
    await device.connect();
  });
  after(async () => {
   await device.closeConnection();
  });

  describe('shell', async () => {
    it('should return a not found message for an unknown command', async () => {
      let commandString = "asdf";
      let expectedReturnString = `/system/bin/sh: ${commandString}: not found`;
      let command = { // set print to false so we get the data back as a string
        type: "shell"
      , string: commandString
      , print: false
      };
      let output = await device.runCommand(command);
      output.indexOf(expectedReturnString).should.not.equal(-1);
    });
    it('should return an error message if we run a shell command incorrectly', async () => {
      let commandString = "touch";
      let expectedReturnString = "touch: no file specified";
      let command = { // set print to false so we get the data back as a string
        type: "shell"
      , string: commandString
      , print: false
      };
      let output = await device.runCommand(command);
      output.indexOf(expectedReturnString).should.not.equal(-1);
    });
    it('should return successful output if we run a shell command correctly', async () => {
      let commandString = "cd sdcard; pwd";
      let expectedReturnString = "/sdcard";
      let command = { // set print to false so we get the data back as a string
        type: "shell"
      , string: commandString
      , print: false
      };
      let output = await device.runCommand(command);
      output.indexOf(expectedReturnString).should.not.equal(-1);
    });
  });
  describe('push', () => {
    const smallFile = path.resolve(__dirname
                                  , '..'
                                  , '..'
                                  , '..'
                                  , 'test'
                                  , 'fixtures'
                                  , 'smallFile');
    const largeFile = path.resolve(__dirname
                                  , '..'
                                  , '..'
                                  , '..'
                                  , 'test'
                                  , 'fixtures'
                                  , 'largeFile');
    const destination = "sdcard/";

    it('should upload smallFile to device', async () => {
      const stats = await fs.stat(smallFile);
      const smallFileSize = stats.size.toString();

      let command = {
        type:        "push"
      , source:      smallFile
      , destination: destination
      };
      await device.runCommand(command);
      let lsCommand = {
        type:   "shell"
      , string: "ls -al sdcard/ | grep smallFile"
      , print:  false
      };
      let output = await device.runCommand(lsCommand);
      output.indexOf(smallFileSize).should.not.equal(-1);
    });
    it('should upload largeFile to device', async () => {
      const stats = await fs.stat(largeFile);
      const largeFileSize = stats.size.toString();

      let command = {
        type:        "push"
      , source:      largeFile
      , destination: destination
      };
      await device.runCommand(command);
      let lsCommand = {
        type:   "shell"
      , string: "ls -al sdcard/ | grep largeFile"
      , print:  false
      };
      let output = await device.runCommand(lsCommand);
      output.indexOf(largeFileSize).should.not.equal(-1);
    });
    it('should return -1 if the source file does not exist', async () => {
      let command = {
        type:        "push"
      , source:      path.resolve(__dirname, 'nonExistantFile')
      , destination: destination
      };
      let retValue = await device.runCommand(command);
      retValue.should.equal(-1);
    });
  });
  describe('pull', () => {
    const smallFile = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'smallFile');
    const largeFile = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'largeFile');
    const tempTestPath = path.resolve(__dirname, '..', '..', '..', 'tempTest');
    const push_destination = "sdcard/";

    before(async () => {
      await fs.mkdir(tempTestPath);
    });
    after(async () => {
      await fs.rimraf(tempTestPath);
    });

    it('should pull down all of smallFile', async () => {
      // push smallfile before trying to pull it
      let push_command = {
        type:        "push"
      , source:      smallFile
      , destination: push_destination
      };
      await device.runCommand(push_command);

      let destination = `${tempTestPath}/smallFile`;
      let command = {
        type:        "pull"
      , source:      "sdcard/smallFile"
      , destination: destination
      };
      let fileSize = await device.runCommand(command);
      let stats = await fs.stat(destination);
      fileSize.should.equal(stats.size);
    });
    it('should pull down all of largeFile', async () => {
      // push largefile before trying to pull it
      let push_command = {
        type:        "push"
      , source:      largeFile
      , destination: push_destination
      };
      await device.runCommand(push_command);

      let destination = `${tempTestPath}/largeFile`;
      let command = {
        type:        "pull"
      , source:      "sdcard/largeFile"
      , destination: destination
      };
      let fileSize = await device.runCommand(command);
      let stats = await fs.stat(destination);
      fileSize.should.equal(stats.size);
    });
    it('should return a filesize of -1 if the file does not exist', async () => {
      // try and pull a file we just pushed to the device
      // except leave off the file extension
      let command = {
        type:        "pull"
      , source:      "sdcard/adbCapture"
      , destination: path.resolve(__dirname, '..', '..', '..')
      };
      let output = await device.runCommand(command);
      output.should.equal(-1);
    });
  });
  describe('list', () => {
    it('should return a list of files in a folder', async () => {
      // Hard to test symlinks because we can't create them on an un-rooted phone
      let commandString = "cd sdcard; mkdir tmp; cd tmp; touch file1; touch file2; mkdir folder1";
      let command = { // set print to false so we get the data back as a string
        type: "shell"
      , string: commandString
      , print: false
      };
      await device.runCommand(command);
      command = {
        type: "list"
      , remotePath: "sdcard/tmp"
      };
      let output = await device.runCommand(command);
      let filenames = output.map(file => file.filename);
      filenames.should.deep.equal(['file1', 'file2', 'folder1']);
      let filetypes = output.map(file => file.type);
      filetypes.should.deep.equal([
        FILE_TYPES.FILE
      , FILE_TYPES.FILE
      , FILE_TYPES.DIRECTORY
      ]);
    });
    it('should return an empty array for an empty folder', async () => {
      let command = {
        type: "list"
      , remotePath: "sdcard/tmp/folder1"
      };
      let output = await device.runCommand(command);
      output.length.should.equal(0);
    });
    it('should return an empty array when called on a file', async () => {
      let command = {
        type: "list"
      , remotePath: "sdcard/tmp/file1"
      };
      let output = await device.runCommand(command);
      output.length.should.equal(0);
    });
    it('should return an empty array when called on a non-existent remote path', async () => {
      let command = {
        type: "list"
      , remotePath: "sdcard/tmp/" + Date.now()
      };
      let output = await device.runCommand(command);
      output.length.should.equal(0);
    });
  });
  describe('install', () => {
    it('should be able to install and run an app', async function () {
      this.timeout(8000);
      const source = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'ContactManager.apk');
      const runApp = `${packageName}/${activityName}`;
      await device.runCommand({ type: "install", source: source });
      let output = await device.runCommand({ type: "shell"
                                           , string: runApp
                                           , print: false });
      let errorMsg = `Error: Activity class {${packageName}/${packageName}.${activityName}} does not exist.`;
      output.indexOf(errorMsg).should.equal(-1);
    });
  });
  describe('uninstall', () => {
    before(async () => {
      const source = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'ContactManager.apk');
      const runApp = `${packageName}/${activityName}`;
      await device.runCommand({ type: "install", source: source });
      await device.runCommand({ type: "shell"
                              , string: runApp
                              , print: false });
    });
    it('should uninstall the app we have installed', async () => {
      let output = await device.runCommand({ type: "uninstall", packageName: packageName });
      output.indexOf(`Success`).should.not.equal(-1);
    });
  });
  describe('reboot', () => {
    // not using an arrow function so that the this context is correct for this.timeout
    it('should (the device) be available for commands after reboot', async function () {
      // override default timeout since we need to wait for the device to reboot
      this.timeout(30000);
      let command = {
        type:   "reboot"
      };
      await device.runCommand(command);
      // sleep then connect to the device again
      await sleep(20000); // time required before an S4 running Android 5 is available
      availableDevices = await ADB.findAdbDevices();
      // just select the first device
      device = new ADB(CONNECTION_TYPES.USB, availableDevices[0]);
      await device.connect();
      // run a very basic command to confirm device is okay
      let commandString = "cd sdcard/ ; pwd";
      let expectedReturnString = "/sdcard";
      let checkCommand = { // set print to false so we get the data back as a string
        type: "shell"
      , string: commandString
      , print: false
      };
      let output = await device.runCommand(checkCommand);
      output.trim().should.equal(expectedReturnString);
    });
  });
});
