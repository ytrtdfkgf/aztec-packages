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

enum WorldStateMsgTypes { GET_TREE_INFO_REQUEST = FIRST_APP_MSG_TYPE, GET_TREE_INFO_RESPONSE, APPEND_LEAVES_REQUEST };

struct TreeIdOnlyRequest {
    MerkleTreeId id;
    MSGPACK_FIELDS(id);
};

struct GetTreeInfoRequest {
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
