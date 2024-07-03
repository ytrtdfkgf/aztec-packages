#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/append_only_tree/append_only_tree.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/crypto/merkle_tree/response.hpp"
#include "barretenberg/world_state/block_specifier.hpp"
#include "barretenberg/world_state/tree_with_store.hpp"
#include <memory>
#include <tuple>
#include <utility>
#include <variant>

namespace bb::world_state {

const uint WORLD_STATE_MAX_DB_COUNT = 16;

const uint NULLIFIER_TREE_HEIGHT = 20;
const uint NOTE_HASH_TREE_HEIGHT = 32;
const uint PUBLIC_DATA_TREE_HEIGHT = 40;
const uint L1_TO_L2_MSG_TREE_HEIGHT = 16;
const uint ARCHIVE_TREE_HEIGHT = 16;

using namespace bb::crypto::merkle_tree;

WorldState::WorldState(uint threads, const std::string& data_dir, uint map_size_kb)
    : _workers(threads)
{
    _lmdb_env = std::make_unique<LMDBEnvironment>(data_dir, map_size_kb, WORLD_STATE_MAX_DB_COUNT, threads);

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "nullifier_tree");
        auto store = std::make_unique<NullifierStore>("nullifier_tree", NULLIFIER_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<NullifierTree>(*store, _workers, 2);
        _trees.insert(std::make_pair(MerkleTreeId::NULLIFIER_TREE,
                                     TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store))));
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "note_hash_tree");
        auto store = std::make_unique<FrStore>("note_hash_tree", NOTE_HASH_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert(std::make_pair(MerkleTreeId::NOTE_HASH_TREE,
                                     TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store))));
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "public_data_tree");
        auto store = std::make_unique<PublicDataStore>("public_data_tree", PUBLIC_DATA_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<PublicDataTree>(*store, this->_workers, 2);
        _trees.insert(std::make_pair(MerkleTreeId::PUBLIC_DATA_TREE,
                                     TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store))));
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "message_tree");
        auto store = std::make_unique<FrStore>("message_tree", L1_TO_L2_MSG_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert(std::make_pair(MerkleTreeId::L1_TO_L2_MESSAGE_TREE,
                                     TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store))));
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "archive_tree");
        auto store = std::make_unique<FrStore>("archive_tree", ARCHIVE_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert(std::make_pair(MerkleTreeId::ARCHIVE,
                                     TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store))));
    }
}

TreeInfo WorldState::get_tree_info(BlockSpecifier s, MerkleTreeId id)
{
    (void)s;
    return std::visit(
        [&](auto&& wrapper) {
            Signal signal(1);
            TreeMetaResponse response;

            // std::visit([](auto s) { std::cout << s << "\n"; }, s);

            auto callback = [&](const TypedResponse<TreeMetaResponse>& meta) {
                response = meta.inner;
                signal.signal_level(0);
            };

            wrapper.tree->get_meta_data(false, callback);
            signal.wait_for_level(0);

            return TreeInfo{ .id = id, .root = response.root, .size = response.size, .depth = response.depth };
        },
        _trees.at(id));
}

template <typename T> void WorldState::append_leaves(MerkleTreeId id, const std::vector<T>& leaves)
{
    (void)id;
    (void)leaves;
}
} // namespace bb::world_state
