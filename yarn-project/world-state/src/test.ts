import { MerkleTreeId, SiblingPath } from '@aztec/circuit-types';
import {
  Fr,
  NULLIFIER_TREE_HEIGHT,
  NullifierLeaf,
  NullifierLeafPreimage,
  PublicDataTreeLeaf,
  PublicDataTreeLeafPreimage,
} from '@aztec/circuits.js';
import { computeRootFromSiblingPath } from '@aztec/circuits.js/merkle';
import { pedersenHash } from '@aztec/foundation/crypto';
import { sleep } from '@aztec/foundation/sleep';
import { AztecLmdbStore } from '@aztec/kv-store/lmdb';

import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { NativeWorldStateService } from './native/native_world_state.js';
import { type IndexedTreeId } from './world-state-db/merkle_tree_operations.js';
import { MerkleTrees } from './world-state-db/merkle_trees.js';

const testDir = await mkdtemp(join(tmpdir(), 'native_world_state_test-'));
const nativeDataDir = join(testDir, 'napi');
const jsDataDir = join(testDir, 'js');

await mkdir(nativeDataDir);
await mkdir(jsDataDir);

const nativeWS = await NativeWorldStateService.create('world_state_napi', 'WorldState', nativeDataDir);
const jsWS = await MerkleTrees.new(AztecLmdbStore.open(jsDataDir));

async function assertTreeInfo(treeId: MerkleTreeId, includeUncommitted = false) {
  const nativeInfo = await nativeWS.getTreeInfo(treeId, includeUncommitted);
  const jsInfo = await jsWS.getTreeInfo(treeId, includeUncommitted);
  console.assert(nativeInfo.treeId === jsInfo.treeId);
  console.assert(nativeInfo.depth === jsInfo.depth);
  console.assert(nativeInfo.size === jsInfo.size);
  console.assert(Fr.fromBuffer(nativeInfo.root).equals(Fr.fromBuffer(jsInfo.root)));
}

async function assertLeafPreimage(treeId: IndexedTreeId, index: bigint, includeUncommitted = false) {
  const nativeLeaf = await nativeWS.getLeafPreimage(treeId, index, includeUncommitted);
  const jsLeaf = await jsWS.getLeafPreimage(treeId, index, includeUncommitted);
  console.assert(nativeLeaf, 'missing native leaf');
  console.assert(jsLeaf, 'missing js leaf');
  console.assert(nativeLeaf?.getKey() === jsLeaf?.getKey(), 'different keys');
  console.assert(nativeLeaf?.getNextIndex() === jsLeaf?.getNextIndex(), 'different next index');
  console.assert(nativeLeaf?.getNextKey() === jsLeaf?.getNextKey(), 'different next key');
}

async function assertSiblingPaths(treeId: IndexedTreeId, index: bigint, includeUncommitted = false) {
  const [nativeLeaf, nativePath, nativeInfo, jsLeaf, jsPath, jsInfo] = await Promise.all([
    nativeWS.getLeafPreimage(treeId, index, includeUncommitted),
    nativeWS.getSiblingPath(treeId, index, includeUncommitted),
    nativeWS.getTreeInfo(treeId, includeUncommitted),
    jsWS.getLeafPreimage(treeId, index, includeUncommitted),
    jsWS.getSiblingPath(treeId, index, includeUncommitted),
    jsWS.getTreeInfo(treeId, includeUncommitted),
  ]);

  console.assert(nativeLeaf, 'missing native leaf at index', index);
  console.assert(jsLeaf, 'missing js leaf at index', index);

  const nativeRoot = computeRootFromSiblingPath(
    pedersenHash(nativeLeaf!.toHashInputs()).toBuffer(),
    nativePath.toBufferArray(),
    Number(index),
  );

  const jsRoot = computeRootFromSiblingPath(
    pedersenHash(jsLeaf!.toHashInputs()).toBuffer(),
    jsPath.toBufferArray(),
    Number(index),
  );

  console.assert(
    Fr.fromBuffer(nativeInfo.root).equals(Fr.fromBuffer(nativeRoot)),
    'Native sibling path mismatch with native root at index',
    index,
  );
  console.assert(
    Fr.fromBuffer(jsInfo.root).equals(Fr.fromBuffer(jsRoot)),
    'JS sibling path mismatch with JS root at index',
    index,
  );
  console.assert(
    Fr.fromBuffer(nativeInfo.root).equals(Fr.fromBuffer(jsInfo.root)),
    "Native and JS roots don't match at index",
    index,
  );

  for (let i = 0; i < nativeInfo.depth; i++) {
    const nativeSibling = nativePath.toFields()[i];
    const jsSibling = jsPath.toFields()[i];

    if (!nativeSibling.equals(jsSibling)) {
      console.log(
        'Sibling path mismatch at leaf index',
        index,
        'sibling',
        i,
        'at level',
        nativeInfo.depth - i,
        nativeSibling,
        jsSibling,
      );
    }
  }
}

// const treeIds = Object.values(MerkleTreeId)
//   .filter((x): x is MerkleTreeId => typeof x === 'number')
//   .map(x => [MerkleTreeId[x], x] as const);

const treeIds = [[MerkleTreeId[MerkleTreeId.NULLIFIER_TREE], MerkleTreeId.NULLIFIER_TREE]] as const;

for (const [treeName, treeId] of treeIds) {
  const leaf = new Fr(142);
  const leafIndex = 128n;
  const nsb127pre = await nativeWS.getSiblingPath(treeId, leafIndex - 1n, true);
  const [nr, jr] = await Promise.all([
    nativeWS.batchInsert(treeId, [leaf.toBuffer()]),
    jsWS.batchInsert(treeId, [leaf.toBuffer()], 1),
  ]);
  const nsb127 = await nativeWS.getSiblingPath(treeId, leafIndex - 1n, true);
  const jsb127 = await jsWS.getSiblingPath(treeId, leafIndex - 1n, true);

  assertSiblingPaths(treeId, leafIndex, true);
  console.log(nr.lowLeavesWitnessData);
  console.log('127th sibling path before insertion', nsb127pre.toFields());
  console.log();
  console.log('low leaf witness sibling path', nr.lowLeavesWitnessData![0].siblingPath.toFields());
  console.log();
  console.log('127th sibling path after insertion', nsb127.toFields());
  console.log();
  console.log();
  console.log('lwo leaf witness sibling data from js', jr.lowLeavesWitnessData![0].siblingPath.toFields());
  console.log();
  console.log('127th sibling path after insertion from js', jsb127.toFields());

  // await Promise.all([nativeWS.commit(), jsWS.commit()]);

  // for (let i = 0; i <= 128; i++) {
  //   // await assertLeafPreimage(treeId, BigInt(i), true);
  //   await assertSiblingPaths(treeId, BigInt(i), true);
  // }
}
