import { type MerkleTreeId } from '@aztec/circuit-types';
import {
  AppendOnlyTreeSnapshot,
  Fr,
  INITIAL_L2_BLOCK_NUM,
  type NullifierLeaf,
  type PublicDataTreeLeaf,
  type UInt32,
} from '@aztec/circuits.js';

export type MessageHeaderInit = {
  /** The message ID. Optional, if not set defaults to 0 */
  messageId?: number;
  /** Identifies the original request. Optional */
  requestId?: number;
};

export class MessageHeader {
  /** An number to identify this message */
  public readonly messageId: number;
  /** If this message is a response to a request, the messageId of the request */
  public readonly requestId: number;

  constructor({ messageId, requestId }: MessageHeaderInit) {
    this.messageId = messageId ?? 0;
    this.requestId = requestId ?? 0;
  }

  static fromMessagePack(data: object): MessageHeader {
    return new MessageHeader(data as MessageHeaderInit);
  }
}

export class TypedMessage<T, B> {
  public constructor(public readonly msgType: T, public readonly header: MessageHeader, public readonly value: B) {}

  static fromMessagePack<T, B>(data: Record<string, any>): TypedMessage<T, B> {
    return new TypedMessage(data['msgType'], MessageHeader.fromMessagePack(data['header']), data['value']);
  }
}

export interface NativeInstance {
  call(msg: Buffer | Uint8Array): Promise<any>;
}

export enum WorldStateMessageType {
  GET_TREE_INFO = 100,
  GET_STATE_REFERENCE,

  FIND_LEAF_INDEX,
  GET_LEAF_VALUE,
  GET_LEAF_PREIMAGE,
  GET_SIBLING_PATH,

  UPDATE_ARCHIVE,
  UPDATE_PUBLIC_DATA,
  APPEND_LEAVES,
  BATCH_INSERT,

  COMMIT,
  ROLLBACK,

  SYNC_BLOCK,
}

interface WithTreeId {
  treeId: MerkleTreeId;
}

interface WithWorldStateRevision {
  revision: WorldStateRevision;
}

interface WithLeafIndex {
  leafIndex: bigint;
}

type Leaf = Fr | NullifierLeaf | PublicDataTreeLeaf;

interface WithLeafValue {
  leaf: Leaf;
}

interface WithLeaves {
  leaves: Leaf[];
}

interface GetTreeInfoRequest extends WithTreeId, WithWorldStateRevision {}
interface GetTreeInfoResponse {
  treeId: MerkleTreeId;
  depth: UInt32;
  size: bigint;
  root: Buffer;
}

interface GetSiblingPathRequest extends WithTreeId, WithLeafIndex, WithWorldStateRevision {}
type GetSiblingPathResponse = Buffer[];

interface GetStateReferenceRequest extends WithWorldStateRevision {}
interface GetStateReferenceResponse {
  state: Record<MerkleTreeId, TreeStateReference>;
}

interface GetLeafRequest extends WithTreeId, WithWorldStateRevision, WithLeafIndex {}
type GetLeafResponse = Buffer | { value: Buffer } | { value: Buffer; slot: Buffer };

interface GetLeafPreImageRequest extends WithTreeId, WithLeafIndex, WithWorldStateRevision {}
type GetLeafPreImageResponse = {
  value: { value: Buffer } | { value: Buffer; slot: Buffer };
  nextIndex: bigint;
  nextValue: Buffer;
};

interface FindLeafIndexRequest extends WithTreeId, WithLeafValue, WithWorldStateRevision {
  startIndex: bigint;
}
type FindLeafIndexResponse = bigint | null;

interface UpdatePublicDataRequest {
  leaf: PublicDataTreeLeaf;
}

interface UpdateArchive {
  blockHash: Fr;
  stateHash: Fr;
}

interface AppendLeavesRequest extends WithTreeId, WithLeaves {}

interface BatchInsertRequest extends WithTreeId, WithLeaves {}
interface BatchInsertResponse {}

interface SyncBlockRequest {}
interface SyncBlockResponse {}

export type WorldStateRequest = {
  [WorldStateMessageType.GET_TREE_INFO]: GetTreeInfoRequest;
  [WorldStateMessageType.GET_STATE_REFERENCE]: GetStateReferenceRequest;
  [WorldStateMessageType.GET_SIBLING_PATH]: GetSiblingPathRequest;

  [WorldStateMessageType.GET_LEAF_VALUE]: GetLeafRequest;
  [WorldStateMessageType.FIND_LEAF_INDEX]: FindLeafIndexRequest;
  [WorldStateMessageType.GET_LEAF_PREIMAGE]: GetLeafPreImageRequest;

  [WorldStateMessageType.UPDATE_ARCHIVE]: UpdateArchive;
  [WorldStateMessageType.UPDATE_PUBLIC_DATA]: UpdatePublicDataRequest;
  [WorldStateMessageType.APPEND_LEAVES]: AppendLeavesRequest;
  [WorldStateMessageType.BATCH_INSERT]: BatchInsertRequest;

  [WorldStateMessageType.COMMIT]: void;
  [WorldStateMessageType.ROLLBACK]: void;

  [WorldStateMessageType.SYNC_BLOCK]: SyncBlockRequest;
};

export type WorldStateResponse = {
  [WorldStateMessageType.GET_TREE_INFO]: GetTreeInfoResponse;
  [WorldStateMessageType.GET_STATE_REFERENCE]: GetStateReferenceResponse;
  [WorldStateMessageType.GET_SIBLING_PATH]: GetSiblingPathResponse;

  [WorldStateMessageType.GET_LEAF_VALUE]: GetLeafResponse;
  [WorldStateMessageType.FIND_LEAF_INDEX]: FindLeafIndexResponse;
  [WorldStateMessageType.GET_LEAF_PREIMAGE]: GetLeafPreImageResponse;

  [WorldStateMessageType.UPDATE_ARCHIVE]: void;
  [WorldStateMessageType.UPDATE_PUBLIC_DATA]: void;
  [WorldStateMessageType.APPEND_LEAVES]: void;
  [WorldStateMessageType.BATCH_INSERT]: BatchInsertResponse;

  [WorldStateMessageType.COMMIT]: void;
  [WorldStateMessageType.ROLLBACK]: void;

  [WorldStateMessageType.SYNC_BLOCK]: SyncBlockResponse;
};

export type WorldStateRevision = -1 | 0 | UInt32;
export function worldStateRevision(includeUncommittedOrBlock: false | true | number): WorldStateRevision {
  if (typeof includeUncommittedOrBlock === 'number') {
    if (includeUncommittedOrBlock < INITIAL_L2_BLOCK_NUM || !Number.isInteger(includeUncommittedOrBlock)) {
      throw new TypeError('Invalid block number: ' + includeUncommittedOrBlock);
    }

    return includeUncommittedOrBlock;
  } else if (includeUncommittedOrBlock) {
    return -1;
  } else {
    return 0;
  }
}

type TreeStateReference = {
  root: Buffer;
  size: number;
};

export function treeStateReferenceToSnapshot(ref: TreeStateReference): AppendOnlyTreeSnapshot {
  return new AppendOnlyTreeSnapshot(Fr.fromBuffer(ref.root), ref.size);
}
