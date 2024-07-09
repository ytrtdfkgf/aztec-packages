#pragma once
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/messaging/header.hpp"
#include "barretenberg/serialize/msgpack.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include <cstdint>
#include <string>

namespace bb::world_state {

using namespace bb::messaging;

enum WorldStateMessageType {
    GET_TREE_INFO = FIRST_APP_MSG_TYPE,
    GET_STATE_REFERENCE,

    FIND_LEAF_INDEX,
    GET_LEAF_VALUE,
    GET_LEAF_PREIMAGE,
    GET_SIBLING_PATH,

    UPDATE_ARCHIVE,
    UPDATE_PUBLIC_DATA,
    APPEND_LEAVES,
    BATCH_INSERT,

    SYNC_BLOCK,

    COMMIT,
    ROLLBACK
};

struct TreeIdOnlyRequest {
    MerkleTreeId treeId;
    MSGPACK_FIELDS(treeId);
};

struct TreeIdAndRevisionRequest {
    MerkleTreeId treeId;
    // -1 uncomitted state
    // 0 latest committed state
    // > 0 specific block number
    int revision;
    MSGPACK_FIELDS(treeId, revision);
};

struct GetTreeInfoRequest {
    MerkleTreeId treeId;
    int revision;

    MSGPACK_FIELDS(treeId, revision);
};

struct GetStateReference {
    int revision;
    MSGPACK_FIELDS(revision);
};

struct GetSiblingPathRequest {
    MerkleTreeId treeId;
    int revision;
    index_t leafIndex;

    MSGPACK_FIELDS(treeId, revision, leafIndex);
};

struct GetLeafValueRequest {
    MerkleTreeId treeId;
    int revision;
    index_t leafIndex;

    MSGPACK_FIELDS(treeId, revision, leafIndex);
};

struct GetLeafPreimageRequest {
    MerkleTreeId treeId;
    int revision;
    index_t leafIndex;

    MSGPACK_FIELDS(treeId, revision, leafIndex);
};

template <typename T> struct GetLeafIndexRequest {
    MerkleTreeId treeId;
    int revision;
    T leaf;

    MSGPACK_FIELDS(treeId, revision, leaf);
};

template <typename T> struct AppendLeavesRequest {
    MerkleTreeId treeId;
    std::vector<T> leaves;
    MSGPACK_FIELDS(treeId, leaves);
};

struct UpdatePublicDataRequest {
    crypto::merkle_tree::PublicDataLeafValue leaf;
    MSGPACK_FIELDS(leaf);
};

template <typename T> struct BatchInsertRequest {
    MerkleTreeId treeId;
    std::vector<T> leaves;
    MSGPACK_FIELDS(treeId, leaves);
};

struct SyncBlockRequest {
    WorldStateReference blockStateRef;
    bb::fr blockHash;
    std::vector<bb::fr> newNoteHashes, newL1ToL2Messages;
    std::vector<crypto::merkle_tree::NullifierLeafValue> newNullifiers;
    std::vector<crypto::merkle_tree::PublicDataLeafValue> newPublicDataWrites;

    MSGPACK_FIELDS(blockStateRef, blockHash, newNoteHashes, newL1ToL2Messages, newNullifiers, newPublicDataWrites);
};

} // namespace bb::world_state

MSGPACK_ADD_ENUM(bb::world_state::WorldStateMessageType)
