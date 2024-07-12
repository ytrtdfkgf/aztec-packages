#pragma once

#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/crypto/merkle_tree/types.hpp"
#include "barretenberg/ecc/curves/bn254/fr.hpp"

namespace bb::world_state {

enum MerkleTreeId {
    NULLIFIER_TREE = 0,
    NOTE_HASH_TREE = 1,
    PUBLIC_DATA_TREE = 2,
    L1_TO_L2_MESSAGE_TREE = 3,
    ARCHIVE = 4,
};

struct TreeStateReference {
    bb::fr root;
    bb::crypto::merkle_tree::index_t size;
    MSGPACK_FIELDS(root, size);

    bool operator==(const TreeStateReference& other) const { return root == other.root && size == other.size; }
};

struct WorldStateReference {
    std::unordered_map<MerkleTreeId, TreeStateReference> state;
    MSGPACK_FIELDS(state);

    bool operator==(const WorldStateReference& other) const { return state == other.state; }
};

struct BlockData {
    WorldStateReference block_state_ref;
    bb::fr block_hash;
    std::vector<bb::fr> new_notes;
    std::vector<bb::fr> new_l1_to_l2_messages;
    std::vector<crypto::merkle_tree::NullifierLeafValue> new_nullifiers;
    // take public writes as individual tx batches so that we don't have to collapse writes to the same slot across txs
    std::vector<std::vector<crypto::merkle_tree::PublicDataLeafValue>> batches_of_public_writes;
};
} // namespace bb::world_state
