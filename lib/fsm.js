import StateMachine from 'fsm-as-promised';
import { asyncify } from 'asyncbox';

let fsm = StateMachine({
  condition: 0,
  // initial: "startConnect",
  events: [
    { name: "start", from: "none", to: "startConnect" },
    { name: "sentCnxn", from: "startConnect", to: "waitForAuth" },
    { name: "recvdAuth", from: "waitForAuth", to: "auth1" },
    { name: "tokenAccepted", from: "auth1", to: "connected" },
    { name: "tokenRefused", from: "auth1", to: "auth2" },
    { name: "publicKeyAccepted", from: "auth2", to: "connected" },
    { name: "publicKeyRefused", from: "auth2", to: "none"},
    { name: "timeout", from: "auth1", to: "startConnect" },
    { name: "timeout", from: "auth2", to: "startConnect" },
    { name: "open", from: "connected", to: "openFunc" }
  ],
  callbacks: {
    onenterednone: function () {
      this.start();
    },
    onenteredopenFunc: function () {
      console.log("openFunc");
    },
    onenteredstartConnect: function () {
      console.log("send cnxn");
      this.sentCnxn();
    },
    onsentCnxn: function() {
      console.log("sent cnxn");
    },
    onenteredwaitForAuth: function () {
      console.log("waiting for auth from device");
      // we'd get the devices response here and
      this.recvdAuth();
    },
    onleavewaitForAuth: function () {
      console.log("recv'd auth from device");
    },
    onenteredauth1: function () {
      console.log("waiting for auth response");
      let condition = Math.floor((Math.random() * 10) + 1);
      if (condition === 1) {
        this.timeout();
      } else if (condition > 1 && condition < 6) {
        this.tokenRefused();
      } else {
        this.tokenAccepted();
      }
    },
    ontokenAccepted: function () {
      console.log("signed token was accepted by device");
    },
    ontokenRefused: function () {
      console.log("signed token was refused, need to send public key");
    },
    onpublicKeyAccepted: function () {
      console.log("public key accepted, connected to device");
    },
    onpublicKeyRefused: function () {
      console.log("public key refused, restarting connection state machine");
    },
    onenteredauth2: function () {
      console.log("wait for cnxn response to our public key");
      let condition = Math.floor((Math.random() * 10) + 1);
      console.log("condition");
      if (condition === 1) {
        this.timeout();
      } else if (condition > 1 && condition < 6) {
        this.publicKeyRefused();
      } else {
        this.publicKeyAccepted();
      }
    },
    ontimeout: function () {
      console.log("timeout occured, returning to start");
    }
  }
});

async function start() {
  await fsm.start();
  console.log(fsm.current);
  fsm.open();
}

asyncify(start);