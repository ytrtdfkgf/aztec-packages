import { SiblingPath } from '@aztec/circuit-types';
import { type Bufferable, type FromBuffer, serializeToBuffer } from '@aztec/foundation/serialize';
import { type Hasher } from '@aztec/types/interfaces';

import { HasherWithStats } from '../hasher_with_stats.js';
import { type MerkleTree } from '../interfaces/merkle_tree.js';

const indexToKeyHash = (name: string, level: number, index: bigint) => `${name}:${level}:${index}`;

const calculateMaxDepth = (treeData: Buffer) => {
  const numBranches = treeData[0];
  const extraLayerNeeded = treeData[1] - 1;
  let branchDepth = numBranches + extraLayerNeeded;
  let maxDepth = branchDepth;
  for (let i = 0; i < numBranches; i++) {
    // we are moving up the tree with each step
    branchDepth -= extraLayerNeeded + i;
    branchDepth += calculateMaxDepth(treeData.subarray(2 * (i + 1)));
    maxDepth = Math.max(maxDepth, branchDepth);
  }
  return maxDepth;
};

/**
 * An ephemeral wonky Merkle tree implementation following the protocol design under logs -> encoding.
 */
export class WonkyTree<T extends Bufferable = Buffer> implements MerkleTree<T> {
  // This map stores index and depth -> value
  private cache: { [key: string]: Buffer } = {};
  // This map stores value -> index and depth, since we have variable depth
  private valueCache: { [key: string]: string } = {};
  protected size: bigint = 0n;
  protected readonly maxIndex: bigint;
  private maxDepth: number = 0;
  protected hasher: HasherWithStats;
  root: Buffer = Buffer.alloc(32);

  public constructor(
    hasher: Hasher,
    private name: string,
    protected deserializer: FromBuffer<T>,
    private treeData: Buffer,
  ) {
    const depth = calculateMaxDepth(treeData);
    this.maxDepth = depth;
    this.hasher = new HasherWithStats(hasher);
    this.maxIndex = 2n ** BigInt(depth) - 1n;
  }

  /**
   * Returns the root of the tree.
   * @returns The root of the tree.
   */
  public getRoot(): Buffer {
    return this.root;
  }

  /**
   * Returns the number of leaves in the tree.
   * @returns The number of leaves in the tree.
   */
  public getNumLeaves() {
    return this.size;
  }

  /**
   * Returns the max depth of the tree.
   * @returns The max depth of the tree.
   */
  public getDepth(): number {
    return this.maxDepth;
  }

  /**
   * @remark A wonky tree is (currently) only ever ephemeral, so we don't use any db to commit to.
   * The fn must exist to implement MerkleTree however.
   */
  public commit(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Rolls back the not-yet-committed changes.
   * @returns Empty promise.
   */
  public rollback(): Promise<void> {
    this.clearCache();
    return Promise.resolve();
  }

  /**
   * Clears the cache.
   */
  private clearCache() {
    this.cache = {};
    this.size = 0n;
  }

  /**
   * @remark A wonky tree can validly have duplicate indices:
   * e.g. 001 (index 1 at level 3) and 01 (index 1 at level 2)
   * So this function cannot reliably give the expected leaf value.
   * We cannot add level as an input as its based on the MerkleTree class's function.
   */
  public getLeafValue(_index: bigint): undefined {
    return undefined;
  }

  /**
   * Returns the index of a leaf given its value, or undefined if no leaf with that value is found.
   * @param leaf - The leaf value to look for.
   * @returns The index of the first leaf found with a given value (undefined if not found).
   * @remark This is NOT the index as inserted, but the index which will be used to calculate path structure.
   */
  public findLeafIndex(value: T): bigint | undefined {
    const key = this.valueCache[serializeToBuffer(value).toString('hex')];
    const [, , index] = key.split(':');
    return BigInt(index);
  }

  /**
   * Returns the first index containing a leaf value after `startIndex`.
   * @param value - The leaf value to look for.
   * @param startIndex - The index to start searching from.
   * @returns The index of the first leaf found with a given value (undefined if not found).
   * @remark This is not really used for a wonky tree, but required to implement MerkleTree.
   */
  public findLeafIndexAfter(value: T, startIndex: bigint): bigint | undefined {
    const index = this.findLeafIndex(value);
    if (!index || index < startIndex) {
      return undefined;
    }
    return index;
  }

  /**
   * Returns a sibling path for the element at the given index.
   * @param level - The level of the element (root is at level 0).
   * @param value - The index of the element.
   * @returns Leaf or node value, or undefined.
   */
  public getNode(level: number, index: bigint): Buffer | undefined {
    if (level < 0 || level > this.maxDepth) {
      throw Error('Invalid level: ' + level);
    }

    if (index < 0 || index >= this.maxIndex) {
      throw Error('Invalid index: ' + index);
    }

    return this.cache[indexToKeyHash(this.name, level, index)];
  }

  /**
   * Returns a sibling path for the element at the given index.
   * @param value - The value of the element.
   * @returns A sibling path for the element.
   * Note: The sibling path is an array of sibling hashes, with the lowest hash (leaf hash) first, and the highest hash last.
   */
  public getSiblingPath<N extends number>(value: bigint): Promise<SiblingPath<N>> {
    const path: Buffer[] = [];
    const [, depth, _index] = this.valueCache[serializeToBuffer(value).toString('hex')].split(':');
    let level = parseInt(depth, 10);
    let index = BigInt(_index);
    while (level > 0) {
      const isRight = index & 0x01n;
      const key = indexToKeyHash(this.name, level, isRight ? index - 1n : index + 1n);
      const sibling = this.cache[key];
      path.push(sibling);
      level -= 1;
      index >>= 1n;
    }
    return Promise.resolve(new SiblingPath<N>(parseInt(depth, 10) as N, path));
  }

  /**
   * Appends the given leaves to the tree.
   * @param leaves - The leaves to append.
   * @returns Empty promise.
   */
  public appendLeaves(leaves: T[]): Promise<void> {
    this.hasher.reset();
    if (this.size + BigInt(leaves.length) - 1n > this.maxIndex) {
      throw Error(`Can't append beyond max index. Max index: ${this.maxIndex}`);
    }
    const [root, _remainingData, remainingLeaves] = this.batchInsert(leaves, this.treeData);
    this.root = root;
    if (remainingLeaves[0]) {
      throw Error(`Appended too many leaves for wonky tree - check treeData is correct: ${this.treeData}`);
    }
    // TODO: Could possibly allow users to append leaves in smaller groups, leaving remaining data to be processed.
    // For now, that would mean storing current depth and index to restart batch insert from.
    // this.treeData = remainingData;

    return Promise.resolve();
  }

  /**
   * Calculates root of given subtree, while adding leaves and nodes to the cache.
   * If a leaf/node's right sibling is not yet calculated, recursively calls itself to find the sibling.
   * @param leaves - The leaves to append.
   * @param treeData - The bytes corresponding to remaining tree structure.
   * @param _startIndex - The first index of this subtree to fill.
   * @param startDepth - The current depth of the subtree.
   * @returns Resulting root of the subtree, the remaining tree data, the remaining leaves to add.
   */
  private batchInsert(_leaves: T[], _treeData: Buffer, _startIndex = 0, startDepth = 0): [Buffer, Buffer, T[]] {
    let leaves = _leaves;
    let treeData = _treeData;
    // number of layers to hash
    const numBranches = treeData[0];
    // number of leaves in this branch - either 1 or 2
    const numLeaves = treeData[1];
    const depth = startDepth + numBranches;
    // move down by num layers
    const startIndex = _startIndex << numBranches;
    // if numLeaves = 1, our current node is a LHS leaf, no need to hash further...
    let thisNode = serializeToBuffer(leaves[0]);
    if (numLeaves == 2) {
      // ... otherwise, we have two child leaves to hash to the current node
      thisNode = this.hasher.hash(serializeToBuffer(leaves[0]), serializeToBuffer(leaves[1]));
      // store the two leaves as children of the current node
      this.storeNode(leaves[0], depth + 1, BigInt(startIndex << 1));
      this.storeNode(leaves[1], depth + 1, BigInt((startIndex << 1) + 1));
    }
    // store this node at the current index
    this.storeNode(thisNode, depth, BigInt(startIndex));
    // update the number of leaves added to the tree
    this.size += BigInt(numLeaves);
    // remove the processed leaves
    leaves = leaves.slice(numLeaves);
    let nextIndex = startIndex + 1;
    let sibling: Buffer;
    for (let i = 0; i < numBranches; i++) {
      // find the RHS sibling by recursively calculating its subtree
      [sibling, treeData, leaves] = this.batchInsert(leaves, treeData.subarray(2), nextIndex, depth - i);
      // hash up the tree
      thisNode = this.hasher.hash(thisNode, sibling);
      // store the new node at the index shifted up
      this.storeNode(thisNode, depth - i - 1, BigInt(nextIndex >> 1));
      // update next index for next iteration
      nextIndex = (nextIndex >> 1) + 1;
    }
    return [thisNode, treeData, leaves];
  }

  /**
   * Stores the given node in the cache.
   * @param value - The value to store.
   * @param depth - The depth of the node in the full tree.
   * @param index - The index of the node at the given depth.
   */
  private storeNode(value: T | Buffer, depth: number, index: bigint) {
    const key = indexToKeyHash(this.name, depth, index);
    this.cache[key] = serializeToBuffer(value);
    this.valueCache[serializeToBuffer(value).toString('hex')] = key;
  }
}
