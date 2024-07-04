#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/append_only_tree/append_only_tree.hpp"
#include "barretenberg/crypto/merkle_tree/fixtures.hpp"
#include "barretenberg/crypto/merkle_tree/hash_path.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/crypto/merkle_tree/response.hpp"
#include "barretenberg/crypto/merkle_tree/signal.hpp"
#include "barretenberg/world_state/tree_with_store.hpp"
#include <memory>
#include <stdexcept>
#include <tuple>
#include <utility>
#include <variant>

namespace bb::world_state {

const uint WORLD_STATE_MAX_DB_COUNT = 16;

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
        [=](auto&& wrapper) {
            Signal signal(1);
            TreeMetaResponse response;

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

StateReference WorldState::get_state_reference()
{
    Signal signal(static_cast<uint32_t>(_trees.size()));
    StateReference state_reference;

    for (auto& [id, tree] : _trees) {
        std::visit(
            [&](auto&& wrapper) {
                auto callback = [&](const TypedResponse<TreeMetaResponse>& meta) {
                    state_reference.snapshots.insert({ id, { .root = meta.inner.root, .size = meta.inner.size } });
                    signal.signal_decrement();
                };
                wrapper.tree->get_meta_data(false, callback);
            },
            tree);
    }

    signal.wait_for_level(0);
    return state_reference;
}

fr_hash_path WorldState::get_sibling_path(MerkleTreeId id, index_t leaf_index)
{
    return std::visit(
        [&](auto&& wrapper) {
            Signal signal(1);
            fr_hash_path path;

            auto callback = [&](const TypedResponse<GetHashPathResponse>& response) {
                path = response.inner.path;
                signal.signal_level(0);
            };

            wrapper.tree->get_hash_path(leaf_index, callback, false);
            signal.wait_for_level(0);

            return path;
        },
        _trees.at(id));
}

template <> void WorldState::append_leaves(MerkleTreeId id, const std::vector<bb::fr>& leaves)
{
    using namespace crypto::merkle_tree;
    if (auto const* wrapper = std::get_if<TreeWithStore<FrTree>>(&_trees.at(id))) {

        Signal signal(1);
        wrapper->tree->add_values(leaves, [&signal](const TypedResponse<AddDataResponse>&) { signal.signal_level(0); });
        signal.wait_for_level(0);
    } else {
        throw std::runtime_error("Invalid tree type for FrTree");
    }
}

} // namespace bb::world_state
