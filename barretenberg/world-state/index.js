var addon = require("bindings")("world_state_napi");
const fs = require("fs");
// const msgpack = require("msgpackr");
const msgpack = require("@msgpack/msgpack");
const crypto = require("crypto");

const MerkleTreeId = {
  NULLIFIER_TREE: 0,
  NOTE_HASH_TREE: 1,
  PUBLIC_DATA_TREE: 2,
  L1_TO_L2_MESSAGE_TREE: 3,
  ARCHIVE: 4,
};

(async function main() {
  fs.mkdirSync("./data", { recursive: true });
  const ws = new addon.WorldState("./data");

  const tree = MerkleTreeId.NULLIFIER_TREE;

  const leaf = {
    value: Buffer.from(
      "05b719e949e7b34382995c9d2df469f74be09daa5810ef14c1260fb2ff4c4298",
      "hex"
    ),
  };

  // {
  //   value: Buffer.from(
  //     "05b719e949e7b34382995c9d2df469f74be09daa5810ef14c1260fb2ff4c4298",
  //     "hex"
  //   ),
  // },
  const meta = await getMeta(ws, tree);
  console.log(meta);
  console.log(meta.value.root.toString("hex"));
  await insert(ws, tree, [leaf]);
  console.log("After insert", await getMeta(ws, tree));
})().then(console.log, (err) => console.log("addon error", String(err)));

function insert(ws, id, leaves) {
  return ws.process(
    msgpack.encode({
      header: {
        messageId: 1,
        requestId: 1,
      },
      msgType: 102,
      value: {
        id,
        leaves,
      },
    })
  );
}

async function getMeta(ws, id) {
  return msgpack.decode(
    await ws.process(
      msgpack.encode({
        header: {
          messageId: 1,
          requestId: 1,
        },
        msgType: 100,
        value: {
          id,
        },
      })
    )
  );
}
