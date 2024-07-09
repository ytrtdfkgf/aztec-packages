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
  type TreeInfo,
} from '../world-state-db/merkle_tree_operations.js';
import {
  MessageHeader,
  type NativeInstance,
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
  });

  private decoder = new Decoder({
    useRecords: false,
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

  batchInsert<TreeHeight extends number, SubtreeSiblingPathHeight extends number, ID extends IndexedTreeId>(
    treeId: ID,
    leaves: Buffer[],
    subtreeHeight: number,
  ): Promise<BatchInsertionResult<TreeHeight, SubtreeSiblingPathHeight>> {
    const resp = await this.call(WorldStateMessageType.BATCH_INSERT, {
      leaves: leaves.map(leaf => leaf as any),
      treeId,
    });

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
      leaf: leaf as any,
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

    if ('slot' in resp.value) {
      return new PublicDataTreeLeafPreimage(
        new PublicDataTreeLeaf(Fr.fromBuffer(resp.value.slot), Fr.fromBuffer(resp.value.value)),
        Fr.fromBuffer(resp.nextValue),
        BigInt(resp.nextIndex),
      );
    } else {
      return new NullifierLeafPreimage(
        new NullifierLeaf(Fr.fromBuffer(resp.value.value)),
        Fr.fromBuffer(resp.nextValue),
        BigInt(resp.nextIndex),
      );
    }
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
    } else if (Buffer.isBuffer(resp)) {
      return resp;
    } else if ('slot' in resp) {
      return new PublicDataTreeLeaf(Fr.fromBuffer(resp.slot), Fr.fromBuffer(resp.value)) as any;
    } else {
      return new NullifierLeaf(Fr.fromBuffer(resp.value)) as any;
    }
  }

  getPreviousValueIndex(
    treeId: IndexedTreeId,
    value: bigint,
    args: boolean,
  ): Promise<{ index: bigint; alreadyPresent: boolean } | undefined> {
    return Promise.reject(new Error('Method not implemented'));
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

    return resp;
  }

  handleL2BlockAndMessages(block: L2Block, l1ToL2Messages: Fr[]): Promise<HandleL2BlockAndMessagesResult> {
    return Promise.reject(new Error('Method not implemented'));
  }

  async rollback(): Promise<void> {
    await this.call(WorldStateMessageType.ROLLBACK, void 0);
  }

  async updateArchive(header: Header, args: boolean): Promise<void> {
    await this.call(WorldStateMessageType.UPDATE_ARCHIVE, {
      blockHash: header.hash(),
      stateHash: header.state.hash(),
    });
  }

  async updateLeaf<ID extends IndexedTreeId>(
    treeId: ID,
    leaf: NullifierLeafPreimage | Buffer,
    index: bigint,
  ): Promise<void> {
    if (treeId !== MerkleTreeId.PUBLIC_DATA_TREE) {
      throw new Error('Unsupported tree ID: ' + treeId);
    }

    await this.call(WorldStateMessageType.UPDATE_PUBLIC_DATA, {
      leaf: leaf as any,
    });
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
