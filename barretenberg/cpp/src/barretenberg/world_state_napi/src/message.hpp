#pragma once
#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/messaging/header.hpp"
#include "barretenberg/serialize/msgpack.hpp"
#include "barretenberg/serialize/msgpack_impl/struct_map_impl.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include <cstdint>
#include <string>

namespace bb::world_state {

using namespace bb::messaging;

enum WorldStateMsgTypes {
    GET_TREE_INFO_REQUEST = FIRST_APP_MSG_TYPE,
    GET_TREE_INFO_RESPONSE,

    APPEND_LEAVES_REQUEST,

    GET_STATE_REFERENCE_REQUEST,
    GET_STATE_REFERENCE_RESPONSE,

    GET_SIBLING_PATH_REQUEST,
    GET_SIBLING_PATH_RESPONSE,

    GET_PREVIOUS_VALUE_INDEX_REQUEST,
    GET_PREVIOUS_VALUE_INDEX_RESPONSE,

    GET_LEAF_PREIMAGE_REQUEST,
    GET_LEAF_PREIMAGE_RESPONSE,

    GET_LEAF_INDEX_REQUEST,
    GET_LEAF_INDEX_RESPONSE,

    GET_LEAF_VALUE_REQUEST,
    GET_LEAF_VALUE_RESPONSE,

    UPDATE_LEAF_REQUEST,
    UPDATE_LEAF_RESPONSE,

    UPDATE_ARCHIVE_REQUEST,
    UPDATE_ARCHIVE_RESPONSE,

    BATCH_INSERT_REQUEST,
    BATCH_INSERT_RESPONSE,

    HANDLE_BLOCK_REQUEST,
    HANDLE_BLOCK_RESPONSE,

    COMMIT_REQUEST,
    COMMIT_RESPONSE,

    ROLLBACK_REQUEST,
    ROLLBACK_RESPONSE,
};

struct TreeIdOnlyRequest {
    MerkleTreeId id;
    MSGPACK_FIELDS(id);
};

template <typename T> struct AppendLeavesRequest {
    MerkleTreeId id;
    std::vector<T> leaves;
    MSGPACK_FIELDS(id, leaves);
};

} // namespace bb::world_state

MSGPACK_ADD_ENUM(bb::world_state::WorldStateMsgTypes)
