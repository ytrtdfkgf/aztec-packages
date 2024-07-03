var addon = require("bindings")("world_state_napi");
const fs = require("fs");
// const msgpack = require("msgpackr");
const msgpack = require("@msgpack/msgpack");
const crypto = require("crypto");

(async function main() {
  fs.mkdirSync("./data", { recursive: true });
  const ws = new addon.WorldState("./data");

  const msg = {
    header: {
      messageId: 1,
      requestId: 1,
    },
    msgType: 100,
    value: {
      id: 0,
    },
  };

  /** @type {Buffer} */
  const buf = await ws.process(msgpack.encode(msg));
  const obj = msgpack.decode(buf);
  console.log(obj);

  console.log(
    "Buffer hash: ",
    crypto.createHash("sha256").update(buf).digest("hex")
  );

  console.log("Buf offset", buf.byteOffset);

  /** @type {Buffer} */
  const otherBuf = obj.value.root;
  console.log("Root offset", otherBuf.byteOffset);

  otherBuf.set([0x01], 0);

  console.log(
    "Buffer hash after modification: ",
    crypto.createHash("sha256").update(buf).digest("hex")
  );
  return ws;
})().then(console.log, console.error);
