/* eslint-disable @typescript-eslint/no-unused-vars */
import { type L2Block, type MerkleTreeHeight, MerkleTreeId, SiblingPath } from '@aztec/circuit-types';
import {
  AppendOnlyTreeSnapshot,
  Fr,
  type Header,
  NullifierLeaf,
  NullifierLeafPreimage,
  PartialStateReference,
  PublicDataTreeLeaf,
  PublicDataTreeLeafPreimage,
  StateReference,
} from '@aztec/circuits.js';
import type { IndexedTreeLeafPreimage } from '@aztec/foundation/trees';
import type { BatchInsertionResult } from '@aztec/merkle-tree';

import bindings from 'bindings';
import { Decoder, Encoder, addExtension } from 'msgpackr';
import { isAnyArrayBuffer } from 'util/types';

import { type MerkleTreeDb, type TreeSnapshots } from '../world-state-db/merkle_tree_db.js';
import {
  type HandleL2BlockAndMessagesResult,
  type IndexedTreeId,
  type MerkleTreeLeafType,
  MerkleTreeLeafValue,
  type TreeInfo,
} from '../world-state-db/merkle_tree_operations.js';
import {
  Leaf,
  MessageHeader,
  type NativeInstance,
  SerializedIndexedLeaf,
  SerializedLeafValue,
  TypedMessage,
  WorldStateMessageType,
  type WorldStateRequest,
  type WorldStateResponse,
  treeStateReferenceToSnapshot,
  worldStateRevision,
} from './message.js';

// small extension to pack an NodeJS Fr instance to a representation that the C++ code can understand
// this only works for writes. Unpacking from C++ can't create Fr instances because the data is passed
// as raw, untagged, buffers. On the NodeJS side we don't know what the buffer represents
// Adding a tag would be a solution, but it would have to be done on both sides and it's unclear where else
// C++ fr instances are sent/received/stored.
addExtension({
  Class: Fr,
  write: fr => fr.toBuffer(),
});

export class NativeWorldStateService implements MerkleTreeDb {
  private nextMessageId = 1;

  private encoder = new Encoder({
    // always encode JS objects as MessagePack maps
    // this makes it compatible with other MessagePack decoders
    useRecords: false,
    int64AsType: 'bigint',
  });

  private decoder = new Decoder({
    useRecords: false,
    int64AsType: 'bigint',
  });

  protected constructor(private instance: NativeInstance) {}

  static create(libraryName: string, className: string, dataDir: string): Promise<NativeWorldStateService> {
    const library = bindings(libraryName);
    const instance = new library[className](dataDir);

    return Promise.resolve(new NativeWorldStateService(instance));
  }

  async appendLeaves<ID extends MerkleTreeId>(treeId: ID, leaves: MerkleTreeLeafType<ID>[]): Promise<void> {
    await this.call(WorldStateMessageType.APPEND_LEAVES, {
      leaves: leaves.map(leaf => leaf as any),
      treeId,
    });
  }

  async batchInsert<TreeHeight extends number, SubtreeSiblingPathHeight extends number, ID extends IndexedTreeId>(
    treeId: ID,
    rawLeaves: Buffer[],
  ): Promise<BatchInsertionResult<TreeHeight, SubtreeSiblingPathHeight>> {
    const leaves = rawLeaves.map((leaf: Buffer) => hydrateLeaf(treeId, leaf));
    const resp = await this.call(WorldStateMessageType.BATCH_INSERT, { leaves, treeId });

    return resp as any;
  }

  async commit(): Promise<void> {
    await this.call(WorldStateMessageType.COMMIT, void 0);
  }

  findLeafIndex(
    treeId: MerkleTreeId,
    value: MerkleTreeLeafType<MerkleTreeId>,
    includeUncommitted: boolean,
  ): Promise<bigint | undefined> {
    return this.findLeafIndexAfter(treeId, value, 0n, includeUncommitted);
  }

  async findLeafIndexAfter(
    treeId: MerkleTreeId,
    leaf: MerkleTreeLeafType<MerkleTreeId>,
    startIndex: bigint,
    includeUncommitted: boolean,
  ): Promise<bigint | undefined> {
    const index = await this.call(WorldStateMessageType.FIND_LEAF_INDEX, {
      leaf: hydrateLeaf(treeId, leaf),
      revision: worldStateRevision(includeUncommitted),
      treeId,
      startIndex,
    });

    if (typeof index === 'number' || typeof index === 'bigint') {
      return BigInt(index);
    } else {
      return undefined;
    }
  }

  async getLeafPreimage(
    treeId: IndexedTreeId,
    leafIndex: bigint,
    args: boolean,
  ): Promise<IndexedTreeLeafPreimage | undefined> {
    const resp = await this.call(WorldStateMessageType.GET_LEAF_PREIMAGE, {
      leafIndex,
      revision: worldStateRevision(args),
      treeId,
    });

    return resp ? deserializeIndexedLeaf(resp) : undefined;
  }

  async getLeafValue(
    treeId: MerkleTreeId,
    leafIndex: bigint,
    includeUncommitted: boolean,
  ): Promise<MerkleTreeLeafType<MerkleTreeId> | undefined> {
    const resp = await this.call(WorldStateMessageType.GET_LEAF_VALUE, {
      leafIndex,
      revision: worldStateRevision(includeUncommitted),
      treeId,
    });

    if (!resp) {
      return undefined;
    }

    const leaf = deserializeLeafValue(resp);
    if (leaf instanceof Fr) {
      return leaf;
    } else {
      return leaf.toBuffer();
    }
  }

  async getPreviousValueIndex(
    treeId: IndexedTreeId,
    value: bigint,
    includeUncommitted: boolean,
  ): Promise<{ index: bigint; alreadyPresent: boolean } | undefined> {
    const resp = await this.call(WorldStateMessageType.FIND_LOW_LEAF, {
      key: new Fr(value),
      revision: worldStateRevision(includeUncommitted),
      treeId,
    });
    return {
      alreadyPresent: resp.alreadyPresent,
      index: BigInt(resp.index),
    };
  }

  async getSiblingPath(
    treeId: MerkleTreeId,
    leafIndex: bigint,
    includeUncommitted: boolean,
  ): Promise<SiblingPath<number>> {
    const siblingPath = await this.call(WorldStateMessageType.GET_SIBLING_PATH, {
      leafIndex,
      revision: worldStateRevision(includeUncommitted),
      treeId,
    });

    return new SiblingPath(siblingPath.length, siblingPath);
  }

  getSnapshot(block: number): Promise<TreeSnapshots> {
    return Promise.reject(new Error('Method not implemented'));
  }

  async getStateReference(includeUncommitted: boolean): Promise<StateReference> {
    const resp = await this.call(WorldStateMessageType.GET_STATE_REFERENCE, {
      revision: worldStateRevision(includeUncommitted),
    });

    return new StateReference(
      treeStateReferenceToSnapshot(resp.state[MerkleTreeId.L1_TO_L2_MESSAGE_TREE]),
      new PartialStateReference(
        treeStateReferenceToSnapshot(resp.state[MerkleTreeId.NOTE_HASH_TREE]),
        treeStateReferenceToSnapshot(resp.state[MerkleTreeId.NULLIFIER_TREE]),
        treeStateReferenceToSnapshot(resp.state[MerkleTreeId.PUBLIC_DATA_TREE]),
      ),
    );
  }

  async getTreeInfo(treeId: MerkleTreeId, includeUncommitted: boolean): Promise<TreeInfo> {
    const resp = await this.call(WorldStateMessageType.GET_TREE_INFO, {
      treeId: treeId,
      revision: worldStateRevision(includeUncommitted),
    });

    return {
      depth: resp.depth,
      root: resp.root,
      size: BigInt(resp.size),
      treeId,
    };
  }

  handleL2BlockAndMessages(block: L2Block, l1ToL2Messages: Fr[]): Promise<HandleL2BlockAndMessagesResult> {
    return Promise.reject(new Error('Method not implemented'));
  }

  async rollback(): Promise<void> {
    await this.call(WorldStateMessageType.ROLLBACK, void 0);
  }

  async updateArchive(header: Header, args: boolean): Promise<void> {
    throw new Error('not implemented');
  }

  async updateLeaf<ID extends IndexedTreeId>(
    treeId: ID,
    leaf: NullifierLeafPreimage | Buffer,
    index: bigint,
  ): Promise<void> {
    throw new Error('Method not implemented');
  }

  private async call<T extends WorldStateMessageType>(
    messageType: T,
    body: WorldStateRequest[T],
  ): Promise<WorldStateResponse[T]> {
    const message = new TypedMessage(messageType, new MessageHeader({ messageId: this.nextMessageId++ }), body);

    const encodedRequest = this.encoder.encode(message);
    const encodedResponse = await this.instance.call(encodedRequest);

    if (typeof encodedResponse === 'undefined') {
      throw new Error('Empty response from native library');
    }

    const buf = Buffer.isBuffer(encodedResponse)
      ? encodedResponse
      : isAnyArrayBuffer(encodedResponse)
      ? Buffer.from(encodedResponse)
      : undefined;

    if (!buf) {
      throw new Error(
        'Invalid response from native library: expected Buffer or ArrayBuffer, got ' + typeof encodedResponse,
      );
    }

    const response = TypedMessage.fromMessagePack<T, WorldStateResponse[T]>(this.decoder.unpack(buf));

    if (response.header.requestId !== message.header.messageId) {
      throw new Error(
        'Response ID does not match request: ' + response.header.requestId + ' != ' + message.header.messageId,
      );
    }

    return response.value;
  }
}

function hydrateLeaf<ID extends MerkleTreeId>(treeId: ID, leaf: MerkleTreeLeafType<ID>) {
  if (leaf instanceof Fr) {
    return leaf as Fr;
  } else if (treeId === MerkleTreeId.NULLIFIER_TREE) {
    return NullifierLeaf.fromBuffer(leaf);
  } else if (treeId === MerkleTreeId.PUBLIC_DATA_TREE) {
    return PublicDataTreeLeaf.fromBuffer(leaf);
  } else {
    throw new Error('Invalid leaf type');
  }
}

function deserializeLeafValue(leaf: SerializedLeafValue): Leaf {
  if (Buffer.isBuffer(leaf)) {
    return Fr.fromBuffer(leaf);
  } else if ('slot' in leaf) {
    return new PublicDataTreeLeaf(Fr.fromBuffer(leaf.slot), Fr.fromBuffer(leaf.value));
  } else {
    return new NullifierLeaf(Fr.fromBuffer(leaf.value));
  }
}

function deserializeIndexedLeaf(leaf: SerializedIndexedLeaf): IndexedTreeLeafPreimage {
  const value = deserializeLeafValue(leaf.value);
  if (value instanceof PublicDataTreeLeaf) {
    return new PublicDataTreeLeafPreimage(value, Fr.fromBuffer(leaf.nextValue), BigInt(leaf.nextIndex));
  } else if (value instanceof NullifierLeaf) {
    return new NullifierLeafPreimage(value, Fr.fromBuffer(leaf.nextValue), BigInt(leaf.nextIndex));
  } else {
    throw new Error('Invalid leaf type');
  }
}
