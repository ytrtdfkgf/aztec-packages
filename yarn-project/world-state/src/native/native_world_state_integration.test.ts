import { MerkleTreeId } from '@aztec/circuit-types';
import {
  Fr,
  NULLIFIER_TREE_HEIGHT,
  NullifierLeaf,
  NullifierLeafPreimage,
  PublicDataTreeLeaf,
  PublicDataTreeLeafPreimage,
} from '@aztec/circuits.js';
import { sleep } from '@aztec/foundation/sleep';
import { AztecLmdbStore } from '@aztec/kv-store/lmdb';

import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { type IndexedTreeId } from '../world-state-db/merkle_tree_operations.js';
import { MerkleTrees } from '../world-state-db/merkle_trees.js';
import { NativeWorldStateService } from './native_world_state.js';

describe('NativeWorldState', () => {
  let testDir: string;
  let nativeWS: NativeWorldStateService;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'native_world_state_test-'));
    const native = join(testDir, 'napi');
    await mkdir(native);
    nativeWS = await NativeWorldStateService.create('world_state_napi', 'WorldState', native);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  describe('compare', () => {
    let currentWS: MerkleTrees;
    beforeAll(async () => {
      const js = join(testDir, 'js');
      await mkdir(js);
      currentWS = await MerkleTrees.new(AztecLmdbStore.open(js));
    });

    async function assert(treeId: MerkleTreeId, includeUncommitted = false) {
      const nativeInfo = await nativeWS.getTreeInfo(treeId, includeUncommitted);
      const jsInfo = await currentWS.getTreeInfo(treeId, includeUncommitted);
      expect(nativeInfo.treeId).toBe(jsInfo.treeId);
      expect(nativeInfo.depth).toBe(jsInfo.depth);
      expect(nativeInfo.size).toBe(jsInfo.size);
      expect(Fr.fromBuffer(nativeInfo.root)).toEqual(Fr.fromBuffer(jsInfo.root));
    }

    it.each(
      Object.values(MerkleTreeId)
        .filter((x): x is MerkleTreeId => typeof x === 'number')
        .map(x => [MerkleTreeId[x], x]),
    )('initial state matches %s', async (_, treeId) => {
      assert(treeId);
    });

    it.each([[MerkleTreeId.NULLIFIER_TREE, [new Fr(142).toBuffer()], 'batchInsert' as const]])(
      'insertions work',
      async (treeId, leaves, fn) => {
        const [native, js] = await Promise.all([
          nativeWS[fn](treeId as any, leaves),
          currentWS[fn](treeId as any, leaves, Math.log2(leaves.length) | 0),
        ]);

        expect(native.sortedNewLeaves.map(Fr.fromBuffer)).toEqual(js.sortedNewLeaves.map(Fr.fromBuffer));
        expect(native.sortedNewLeavesIndexes).toEqual(js.sortedNewLeavesIndexes);
        expect(native.newSubtreeSiblingPath.toFields()).toEqual(js.newSubtreeSiblingPath.toFields());
        expect(native.lowLeavesWitnessData).toEqual(js.lowLeavesWitnessData);
      },
    );

    it.each([[MerkleTreeId.NULLIFIER_TREE, 128n]])('sibling paths match', async (treeId, leaf) => {
      const native = await nativeWS.getSiblingPath(treeId, leaf, false);
      const js = await currentWS.getSiblingPath(treeId, leaf, false);
      expect(native.toFields()).toEqual(js.toFields());
      // expect(native).toEqual(js);
    });
  });

  it('gets tree info', async () => {
    const info = await nativeWS.getTreeInfo(MerkleTreeId.NULLIFIER_TREE, false);
    expect(info.size).toBe(2n); // prefilled with two leaves
  });

  it('gets sibling path', async () => {
    const siblingPath = await nativeWS.getSiblingPath(MerkleTreeId.NULLIFIER_TREE, 0n, false);
    expect(siblingPath.pathSize).toBe(NULLIFIER_TREE_HEIGHT);
  });

  it.each([
    [MerkleTreeId.NULLIFIER_TREE, new NullifierLeaf(new Fr(1n)).toBuffer(), 1n],
    [MerkleTreeId.NOTE_HASH_TREE, new Fr(1n), undefined],
  ])('gets leaf index', async (treeId, leaf, expected) => {
    const index = await nativeWS.findLeafIndex(treeId, leaf, false);
    expect(index).toEqual(expected);
  });

  it('gets state reference', async () => {
    const sr = await nativeWS.getStateReference(false);
    expect(sr).toBeDefined();
  });

  it.each([
    [MerkleTreeId.NULLIFIER_TREE, 0n, Fr.ZERO.toBuffer()],
    [MerkleTreeId.PUBLIC_DATA_TREE, 0n, new PublicDataTreeLeaf(new Fr(0n), new Fr(0n)).toBuffer()],
    [MerkleTreeId.NOTE_HASH_TREE, 0n, undefined],
  ])('gets leaf value', async (id, index, expectedLeaf) => {
    const leaf = await nativeWS.getLeafValue(id, index, false);
    expect(leaf).toEqual(expectedLeaf);
  });

  it.each([
    [MerkleTreeId.NULLIFIER_TREE, 0n, new NullifierLeafPreimage(new Fr(0n), new Fr(1), 1n)],
    [MerkleTreeId.PUBLIC_DATA_TREE, 0n, new PublicDataTreeLeafPreimage(new Fr(0n), new Fr(0n), new Fr(1n), 1n)],
  ])('gets leaf preimage', async (id, index, expected) => {
    const leaf = await nativeWS.getLeafPreimage(id as IndexedTreeId, index, false);
    expect(leaf).toEqual(expected);
  });

  it.each([
    [MerkleTreeId.NULLIFIER_TREE, 42n, 1n, false],
    [MerkleTreeId.NULLIFIER_TREE, 1n, 1n, true],
    [MerkleTreeId.PUBLIC_DATA_TREE, 42n, 1n, false],
    [MerkleTreeId.PUBLIC_DATA_TREE, 1n, 1n, true],
  ])('finds low leaf', async (treeId, key, index, alreadyPresent) => {
    const lowLeaf = await nativeWS.getPreviousValueIndex(treeId as any, key, false);
    expect(lowLeaf).toEqual({ index, alreadyPresent });
  });
});
