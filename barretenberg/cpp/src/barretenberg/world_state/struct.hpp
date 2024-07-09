#pragma once

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
    WorldStateReference state;
    bb::fr hash;
    std::vector<bb::fr> notes;
    std::vector<bb::fr> messages;
    std::vector<crypto::merkle_tree::NullifierLeafValue> nullifiers;
    std::vector<crypto::merkle_tree::PublicDataLeafValue> publicData;

    MSGPACK_FIELDS(state, hash, notes, messages, nullifiers, publicData);
};
} // namespace bb::world_state
