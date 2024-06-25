import { sha256Trunc } from '@aztec/foundation/crypto';
import { Fr } from '@aztec/foundation/fields';
import { type FromBuffer } from '@aztec/foundation/serialize';
import { openTmpStore } from '@aztec/kv-store/utils';
import { type Hasher } from '@aztec/types/interfaces';

import { SHA256Trunc } from '../sha_256.js';
import { StandardTree } from './standard_tree.js';
import { WonkyTree } from './wonky_tree.js';

const noopDeserializer: FromBuffer<Buffer> = {
  fromBuffer: (buffer: Buffer) => buffer,
};

// Follows sol implementation and tests in WonkyMerkle.t.sol
describe('Wonky tree', () => {
  let hasher: Hasher;
  let tree: WonkyTree<Buffer>;
  let leaves: Buffer[];

  const createAndFillTree = async (treeData: Buffer, size: number) => {
    const tree = new WonkyTree(hasher, `test`, noopDeserializer, treeData);
    const leaves = Array(size)
      .fill(0)
      .map((_, i) => sha256Trunc(new Fr(i).toBuffer()));
    // For the final test, we make the final (shifted up) leaf be H(1, 2), so we can calculate the root
    // with a standard tree easily.
    if (leaves[30]) {
      leaves[30] = hasher.hash(new Fr(1).toBuffer(), new Fr(2).toBuffer());
    }
    await tree.appendLeaves(leaves);
    return { tree, leaves };
  };

  beforeAll(() => {
    hasher = new SHA256Trunc();
  });

  // Example - 2 txs:
  //
  //   root
  //  /     \
  // base  base
  describe('2 Transactions', () => {
    const treeData = Buffer.from('0002', 'hex');
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 2);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(1);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      const expectedRoot = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling path', async () => {
      const sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(1);
      const expectedSibPath = [leaves[1]];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
    });
  });

  // Example - 3 txs:
  //
  //        root
  //     /        \
  //   merge     base
  //  /     \
  // base  base
  describe('3 Transactions', () => {
    const treeData = Buffer.from('01020001', 'hex');
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 3);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(2);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      const mergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      const expectedRoot = sha256Trunc(Buffer.concat([mergeNode, leaves[2]]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling path', async () => {
      const sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(2);
      const expectedSibPath = [leaves[1], leaves[2]];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
    });
  });

  // Example - 5 txs (combining above 2 trees):
  //
  //               root
  //          /            \
  //        merge        merge
  //     /        \      /    \
  //   merge     base  base  base
  //  /     \
  // base  base
  // NB: In practice we wouldn't create the structure above as it's likely more efficient to
  // make the tree taller rather than wider, but useful for testing (see next test for realistic structure)
  describe('5 Transactions - ver 1', () => {
    const treeData = Buffer.from('020200010002', 'hex');
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 5);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(3);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      let leftMergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      leftMergeNode = sha256Trunc(Buffer.concat([leftMergeNode, leaves[2]]));
      const rightMergeNode = sha256Trunc(Buffer.concat([leaves[3], leaves[4]]));
      const expectedRoot = sha256Trunc(Buffer.concat([leftMergeNode, rightMergeNode]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling path', async () => {
      const sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(3);
      const expectedSibPath = [leaves[1], leaves[2], sha256Trunc(Buffer.concat([leaves[3], leaves[4]]))];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
    });
  });

  // Example - 5 txs:
  //
  //                  root
  //             /            \
  //          merge           base
  //      /          \
  //   merge        merge
  //  /     \      /     \
  // base  base  base   base
  describe('5 Transactions - ver 2', () => {
    const treeData = Buffer.from('020200020001', 'hex');
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 5);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(3);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      let leftMergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      const rightMergeNode = sha256Trunc(Buffer.concat([leaves[2], leaves[3]]));
      leftMergeNode = sha256Trunc(Buffer.concat([leftMergeNode, rightMergeNode]));
      const expectedRoot = sha256Trunc(Buffer.concat([leftMergeNode, leaves[4]]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling path', async () => {
      const sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(3);
      const expectedSibPath = [leaves[1], sha256Trunc(Buffer.concat([leaves[2], leaves[3]])), leaves[4]];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
    });
  });

  // Example - 6 txs:
  //
  //                  root
  //             /            \
  //         merge4           base
  //      /          \
  //   merge1       merge3
  //  /     \      /     \
  // base  base  base   merge2
  //                    /   \
  //                  base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  describe('6 Transactions', () => {
    const treeData = Buffer.from('0202010100020001', 'hex');
    let thirdMergeNode: Buffer;
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 6);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(4);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      const firstMergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      const secondMergeNode = sha256Trunc(Buffer.concat([leaves[3], leaves[4]]));
      thirdMergeNode = sha256Trunc(Buffer.concat([leaves[2], secondMergeNode]));
      const fourthMergeNode = sha256Trunc(Buffer.concat([firstMergeNode, thirdMergeNode]));
      const expectedRoot = sha256Trunc(Buffer.concat([fourthMergeNode, leaves[5]]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling path', async () => {
      const sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(3);
      const expectedSibPath = [leaves[1], thirdMergeNode, leaves[5]];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
    });
  });

  // Example - 8 txs:
  //
  //                  root
  //             /            \
  //          merge5          merge6
  //      /          \        /    \
  //   merge1       merge4  base  base
  //  /     \      /     \
  // base  base  base   merge3
  //                    /   \
  //                 merge2  base
  //                 /  \
  //              base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  describe('8 Transactions', () => {
    const treeData = Buffer.from('02020101010200010002', 'hex');
    let firstMergeNode: Buffer;
    let fourthMergeNode: Buffer;
    let sixthMergeNode: Buffer;
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 8);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(5);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      firstMergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      const secondMergeNode = sha256Trunc(Buffer.concat([leaves[3], leaves[4]]));
      const thirdMergeNode = sha256Trunc(Buffer.concat([secondMergeNode, leaves[5]]));
      fourthMergeNode = sha256Trunc(Buffer.concat([leaves[2], thirdMergeNode]));
      const fifthMergeNode = sha256Trunc(Buffer.concat([firstMergeNode, fourthMergeNode]));
      sixthMergeNode = sha256Trunc(Buffer.concat([leaves[6], leaves[7]]));
      const expectedRoot = sha256Trunc(Buffer.concat([fifthMergeNode, sixthMergeNode]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling paths', async () => {
      let sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(3);
      let expectedSibPath = [leaves[1], fourthMergeNode, sixthMergeNode];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);

      sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[4].toString('hex')));
      expect(sibPath.pathSize).toEqual(5);
      expectedSibPath = [leaves[3], leaves[5], leaves[2], firstMergeNode, sixthMergeNode];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
      const indexForSibPath = tree.findLeafIndex(leaves[4]);
      expect(indexForSibPath).toEqual(13n);
    });
  });

  // Example - 10 txs:
  //
  //                          root
  //             /                          \
  //          merge5                        merge8
  //      /          \                      /    \
  //   merge1       merge4               merge7 base
  //  /     \      /     \              /   \
  // base  base  base   merge3       merge6 base
  //                    /   \       /     \
  //                 merge2  base  base  base
  //                 /  \
  //              base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  describe('10 Transactions', () => {
    const treeData = Buffer.from('0202010101020001020200010001', 'hex');
    let firstMergeNode: Buffer;
    let fourthMergeNode: Buffer;
    let eighthMergeNode: Buffer;
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 10);
      tree = res.tree;
      leaves = res.leaves;
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(5);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      // Left subtree from merge5:
      firstMergeNode = sha256Trunc(Buffer.concat([leaves[0], leaves[1]]));
      const secondMergeNode = sha256Trunc(Buffer.concat([leaves[3], leaves[4]]));
      const thirdMergeNode = sha256Trunc(Buffer.concat([secondMergeNode, leaves[5]]));
      fourthMergeNode = sha256Trunc(Buffer.concat([leaves[2], thirdMergeNode]));
      const fifthMergeNode = sha256Trunc(Buffer.concat([firstMergeNode, fourthMergeNode]));
      // Right subtree from merge8:
      eighthMergeNode = leaves[6];
      for (let i = 7; i < 10; i++) {
        eighthMergeNode = sha256Trunc(Buffer.concat([eighthMergeNode, leaves[i]]));
      }
      const expectedRoot = sha256Trunc(Buffer.concat([fifthMergeNode, eighthMergeNode]));
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling paths', async () => {
      let sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      expect(sibPath.pathSize).toEqual(3);
      let expectedSibPath = [leaves[1], fourthMergeNode, eighthMergeNode];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);

      sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[4].toString('hex')));
      expect(sibPath.pathSize).toEqual(5);
      expectedSibPath = [leaves[3], leaves[5], leaves[2], firstMergeNode, eighthMergeNode];
      expect(sibPath.toBufferArray()).toEqual(expectedSibPath);
      const indexForSibPath = tree.findLeafIndex(leaves[4]);
      expect(indexForSibPath).toEqual(13n);
    });
  });

  // Example - 31 txs:
  // The same as a standard 32 leaf balanced tree, but with the last 'leaf' shifted up one.
  describe('31 Transactions', () => {
    const treeData = Buffer.from('0402000201020002020200020102000203020002010200020202000201020001', 'hex');
    let stdTree: StandardTree;
    beforeAll(async () => {
      const res = await createAndFillTree(treeData, 31);
      tree = res.tree;
      leaves = res.leaves;
      stdTree = new StandardTree(openTmpStore(true), hasher, `temp`, 5, 0n, noopDeserializer);
      // We have set the last leaf to be H(1, 2), so we can fill a 32 size tree with:
      await stdTree.appendLeaves([...res.leaves.slice(0, 30), new Fr(1).toBuffer(), new Fr(2).toBuffer()]);
    });

    it('Correctly computes tree information', () => {
      expect(tree.getNumLeaves()).toEqual(BigInt(leaves.length));
      expect(tree.getDepth()).toEqual(5);
      expect(tree.findLeafIndex(leaves[0])).toEqual(0n);
    });

    it('Correctly computes root', () => {
      const root = tree.getRoot();
      const expectedRoot = stdTree.getRoot(true);
      expect(root).toEqual(expectedRoot);
    });

    it('Correctly computes sibling paths', async () => {
      let sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[0].toString('hex')));
      let expectedSibPath = await stdTree.getSiblingPath(0n, true);
      expect(sibPath).toEqual(expectedSibPath);
      sibPath = await tree.getSiblingPath(BigInt('0x' + leaves[27].toString('hex')));
      expectedSibPath = await stdTree.getSiblingPath(27n, true);
      expect(sibPath).toEqual(expectedSibPath);
    });
  });
});
