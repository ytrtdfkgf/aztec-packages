#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/append_only_tree/append_only_tree.hpp"
#include "barretenberg/crypto/merkle_tree/fixtures.hpp"
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
        _trees.insert(
            { MerkleTreeId::NULLIFIER_TREE, TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store)) });
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "note_hash_tree");
        auto store = std::make_unique<FrStore>("note_hash_tree", NOTE_HASH_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert(
            { MerkleTreeId::NOTE_HASH_TREE, TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store)) });
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "public_data_tree");
        auto store = std::make_unique<PublicDataStore>("public_data_tree", PUBLIC_DATA_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<PublicDataTree>(*store, this->_workers, 2);
        _trees.insert({ MerkleTreeId::PUBLIC_DATA_TREE,
                        TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store)) });
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "message_tree");
        auto store = std::make_unique<FrStore>("message_tree", L1_TO_L2_MSG_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert({ MerkleTreeId::L1_TO_L2_MESSAGE_TREE,
                        TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store)) });
    }

    {
        auto lmdb_store = std::make_unique<LMDBStore>(*_lmdb_env, "archive_tree");
        auto store = std::make_unique<FrStore>("archive_tree", ARCHIVE_TREE_HEIGHT, *lmdb_store);
        auto tree = std::make_unique<FrTree>(*store, this->_workers);
        _trees.insert(
            { MerkleTreeId::ARCHIVE, TreeWithStore(std::move(tree), std::move(store), std::move(lmdb_store)) });
    }
}

TreeInfo WorldState::get_tree_info(MerkleTreeId id)
{
    return std::visit(
        [&](auto&& wrapper) {
            Signal signal(1);
            TreeMetaResponse response;

            auto callback = [&](const TypedResponse<TreeMetaResponse>& meta) {
                response = meta.inner;
                signal.signal_level(0);
            };

            wrapper.tree->get_meta_data(true, callback);
            signal.wait_for_level(0);

            return TreeInfo{ .id = id, .root = response.root, .size = response.size, .depth = response.depth };
        },
        _trees.at(id));
}

template <typename T> void WorldState::append_leaves(MerkleTreeId id, const std::vector<T>& leaves)
{

    Signal signal(1);

    std::visit(overloaded{
                   [&signal, leaves](TreeWithStore<FrTree> wrapper) {
                       wrapper.tree->add_value(
                           leaves, [&signal](const TypedResponse<AddDataResponse>&) { signal.signal_level(0); });
                   },
                   [&signal, leaves](TreeWithStore<NullifierTree> wrapper) {
                       wrapper.tree->add_or_update_values(
                           leaves, [&signal](const TypedResponse<AddIndexedDataResponse>&) { signal.signal_level(0); });
                   },
                   [&signal, leaves](TreeWithStore<PublicDataTree> wrapper) {
                       wrapper.tree->add_or_update_values(
                           leaves, [&signal](const TypedResponse<AddIndexedDataResponse>&) { signal.signal_level(0); });
                   },
               },
               _trees.at(id));

    signal.wait_for_level(0);
}

template <> void WorldState::append_leaves(MerkleTreeId id, const std::vector<bb::fr>& leaves)
{
    if (auto* const wrapper = std::get_if<TreeWithStore<FrTree>>(&_trees.at(id))) {
        Signal signal(1);
        std::cout << "Adding leaves to FrTree" << std::endl;
        wrapper->tree->add_values(leaves, [&signal](const TypedResponse<AddDataResponse>& r) {
            std::cout << "new root: " << r.inner.root << " new size: " << r.inner.size << "\n";
            signal.signal_level(0);
        });
        signal.wait_for_level(0);
    } else {
        throw std::runtime_error("Invalid tree type for leaves");
    }
}

template <> void WorldState::append_leaves(MerkleTreeId id, const std::vector<NullifierLeafValue>& leaves)
{
    if (auto* const wrapper = std::get_if<TreeWithStore<NullifierTree>>(&_trees.at(id))) {
        Signal signal(1);
        std::cout << "Adding leaves to NUll" << std::endl;
        for (auto& leaf : leaves) {
            std::cout << leaf << std::endl;
        }
        wrapper->tree->add_or_update_values(leaves, [&signal](const TypedResponse<AddIndexedDataResponse>& r) {
            std::cout << "new root: " << r.inner.add_data_result.root << " new size: " << r.inner.add_data_result.size
                      << "\n";
            signal.signal_level(0);
        });
        signal.wait_for_level(0);
    } else {
        throw std::runtime_error("Invalid tree type for leaves");
    }
}
} // namespace bb::world_state
