#pragma once

#include "barretenberg/crypto/merkle_tree/append_only_tree/append_only_tree.hpp"
#include "barretenberg/crypto/merkle_tree/hash.hpp"
#include "barretenberg/crypto/merkle_tree/hash_path.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_tree.hpp"
#include "barretenberg/crypto/merkle_tree/lmdb_store/lmdb_environment.hpp"
#include "barretenberg/crypto/merkle_tree/node_store/cached_tree_store.hpp"
#include "barretenberg/crypto/merkle_tree/types.hpp"
#include "barretenberg/serialize/msgpack.hpp"
#include "barretenberg/world_state/tree_with_store.hpp"
#include "msgpack/adaptor/define_decl.hpp"
#include <unordered_map>

namespace bb::world_state {

using crypto::merkle_tree::index_t;

using HashPolicy = crypto::merkle_tree::PedersenHashPolicy;

using FrStore = crypto::merkle_tree::CachedTreeStore<crypto::merkle_tree::LMDBStore, fr>;
using FrTree = crypto::merkle_tree::AppendOnlyTree<FrStore, HashPolicy>;

using NullifierStore =
    crypto::merkle_tree::CachedTreeStore<crypto::merkle_tree::LMDBStore, crypto::merkle_tree::NullifierLeafValue>;
using NullifierTree = crypto::merkle_tree::IndexedTree<NullifierStore, HashPolicy>;

using PublicDataStore =
    crypto::merkle_tree::CachedTreeStore<crypto::merkle_tree::LMDBStore, crypto::merkle_tree::PublicDataLeafValue>;
using PublicDataTree = crypto::merkle_tree::IndexedTree<PublicDataStore, HashPolicy>;

using TreeVariant = std::variant<TreeWithStore<FrTree>, TreeWithStore<NullifierTree>, TreeWithStore<PublicDataTree>>;

// values match constants exported by @aztec/circuit.js
enum MerkleTreeId {
    NULLIFIER_TREE = 0,
    NOTE_HASH_TREE = 1,
    PUBLIC_DATA_TREE = 2,
    L1_TO_L2_MESSAGE_TREE = 3,
    ARCHIVE = 4,
};

struct TreeInfo {
    /**
     * The tree ID.
     */
    MerkleTreeId id;
    /**
     * The tree root.
     */
    fr root;
    /**
     * The number of leaves in the tree.
     */
    index_t size;

    /**
     * The depth of the tree.
     */
    uint32_t depth;

    MSGPACK_FIELDS(id, root, size, depth);
};

struct AppendOnlyTreeSnapshot {
    bb::fr root;
    index_t size;

    MSGPACK_FIELDS(root, size);
};

struct StateReference {
    // AppendOnlyTreeSnapshot message_tree, note_hash_tree, nullifier_tree, public_data_tree;
    std::unordered_map<MerkleTreeId, AppendOnlyTreeSnapshot> snapshots;
    MSGPACK_FIELDS(snapshots);
};

template <class... Ts> struct overloaded : Ts... {
    using Ts::operator()...;
};

const uint NULLIFIER_TREE_HEIGHT = 20;
const uint NOTE_HASH_TREE_HEIGHT = 32;
const uint PUBLIC_DATA_TREE_HEIGHT = 40;
const uint L1_TO_L2_MSG_TREE_HEIGHT = 16;
const uint ARCHIVE_TREE_HEIGHT = 16;

class WorldState {
  public:
    WorldState(uint threads, const std::string& data_dir, uint map_size_kb);
    ~WorldState() = default;

    TreeInfo get_tree_info(MerkleTreeId id);

    // had trouble using a template for this function
    void append_leaves(MerkleTreeId id, const std::vector<bb::fr>& leaves);
    void append_leaves(MerkleTreeId id, const std::vector<crypto::merkle_tree::NullifierLeafValue>& leaves);
    void append_leaves(MerkleTreeId id, const std::vector<crypto::merkle_tree::PublicDataLeafValue>& leaves);

    StateReference get_state_reference();

    crypto::merkle_tree::fr_hash_path get_sibling_path(MerkleTreeId id, index_t leaf_index);
    // TODO(alexg) get_previous_value_index

    bool get_leaf_preimage(MerkleTreeId id, index_t leaf, crypto::merkle_tree::NullifierLeafValue& value);
    bool get_leaf_preimage(MerkleTreeId id, index_t leaf, crypto::merkle_tree::PublicDataLeafValue& value);

  private:
    std::unique_ptr<crypto::merkle_tree::LMDBEnvironment> _lmdb_env;
    std::unordered_map<MerkleTreeId, TreeVariant> _trees;
    bb::ThreadPool _workers;

    AppendOnlyTreeSnapshot get_tree_snapshot(MerkleTreeId id);
};

} // namespace bb::world_state

MSGPACK_ADD_ENUM(bb::world_state::MerkleTreeId)
