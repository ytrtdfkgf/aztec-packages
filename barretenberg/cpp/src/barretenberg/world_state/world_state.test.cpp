#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/fixtures.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/world_state/history.hpp"
#include <filesystem>
#include <gtest/gtest.h>

using namespace bb::world_state;
using namespace bb::crypto::merkle_tree;

class WorldStateTest : public testing::Test {
  protected:
    void SetUp() override
    {
        // setup with 1MB max db size, 1 max database and 2 maximum concurrent readers
        _directory = randomTempDirectory();
        std::filesystem::create_directories(_directory);
    }

    void TearDown() override { std::filesystem::remove_all(_directory); }

    static std::string _directory;
};

std::string WorldStateTest::_directory;

template <typename Leaf>
void assert_leaf_status(
    const WorldState& ws, WorldStateRevision revision, MerkleTreeId tree_id, index_t leaf_index, bool exists)
{
    std::optional<Leaf> leaf = ws.get_leaf<Leaf>(revision, tree_id, leaf_index);
    EXPECT_EQ(leaf.has_value(), exists);
}

template <typename Leaf>
void assert_leaf_value(
    const WorldState& ws, WorldStateRevision revision, MerkleTreeId tree_id, index_t leaf_index, const Leaf& value)
{
    std::optional<Leaf> leaf = ws.get_leaf<Leaf>(revision, tree_id, leaf_index);
    EXPECT_EQ(leaf.value(), value);
}

template <typename Leaf>
void assert_leaf_index(
    const WorldState& ws, WorldStateRevision revision, MerkleTreeId tree_id, const Leaf& value, index_t expected_index)
{
    std::optional<index_t> index = ws.find_leaf_index<Leaf>(revision, tree_id, value);
    EXPECT_EQ(index.value(), expected_index);
}

void assert_tree_size(const WorldState& ws, WorldStateRevision revision, MerkleTreeId tree_id, size_t expected_size)
{
    auto info = ws.get_tree_info(revision, tree_id);
    EXPECT_EQ(info.size, expected_size);
}

void assert_sibling_path(
    const WorldState& ws, WorldStateRevision revision, MerkleTreeId tree_id, fr root, fr leaf, index_t index)
{
    auto sibling_path = ws.get_sibling_path(revision, tree_id, index);
    fr left, right, hash = leaf;
    for (size_t i = 0; i < sibling_path.size(); ++i) {
        if (index % 2 == 0) {
            left = hash;
            right = sibling_path[i];
        } else {
            left = sibling_path[i];
            right = hash;
        }

        hash = HashPolicy::hash_pair(left, right);
        index >>= 1;
    }

    EXPECT_EQ(hash, root);
}

TEST_F(WorldStateTest, GetInitialTreeInfoForAllTrees)
{
    WorldState ws(1, _directory, 1024);

    {
        auto info = ws.get_tree_info(WorldStateRevision::committed(), MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(info.treeId, MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(info.size, 2);
        EXPECT_EQ(info.depth, NULLIFIER_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x22c4533ddff9ecb72bfc3e762e9d63f17ddd474ae180857ef4656f127c4c848e"));
    }

    {
        auto info = ws.get_tree_info(WorldStateRevision::committed(), MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(info.treeId, MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, NOTE_HASH_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x16642d9ccd8346c403aa4c3fa451178b22534a27035cdaa6ec34ae53b29c50cb"));
    }

    {
        auto info = ws.get_tree_info(WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(info.treeId, MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(info.size, 2);
        EXPECT_EQ(info.depth, PUBLIC_DATA_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x25dc2dfffc26f14b1ac05d5d74a912931b59ca8098d3b3b8cdc0d3da40421b1c"));
    }

    {
        auto info = ws.get_tree_info(WorldStateRevision::committed(), MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(info.treeId, MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, L1_TO_L2_MSG_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }

    {
        auto info = ws.get_tree_info(WorldStateRevision::committed(), MerkleTreeId::ARCHIVE);
        EXPECT_EQ(info.treeId, MerkleTreeId::ARCHIVE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, ARCHIVE_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }
}

TEST_F(WorldStateTest, GetInitialStateReference)
{
    WorldState ws(1, _directory, 1024);
    auto state_ref = ws.get_state_reference(WorldStateRevision::committed());

    EXPECT_EQ(state_ref.state.size(), 5);

    {
        auto snapshot = state_ref.state.at(MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(snapshot.size, 2);
        EXPECT_EQ(snapshot.root, bb::fr("0x22c4533ddff9ecb72bfc3e762e9d63f17ddd474ae180857ef4656f127c4c848e"));
    }

    {
        auto snapshot = state_ref.state.at(MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x16642d9ccd8346c403aa4c3fa451178b22534a27035cdaa6ec34ae53b29c50cb"));
    }

    {
        auto snapshot = state_ref.state.at(MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(snapshot.size, 2);
        EXPECT_EQ(snapshot.root, bb::fr("0x25dc2dfffc26f14b1ac05d5d74a912931b59ca8098d3b3b8cdc0d3da40421b1c"));
    }

    {
        auto snapshot = state_ref.state.at(MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }

    {
        auto snapshot = state_ref.state.at(MerkleTreeId::ARCHIVE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }
}

TEST_F(WorldStateTest, InitialIndexTreePrefill)
{
    WorldState ws(1, _directory, 1024);

    // index trees have a prefill of two
    // verify the world state correctly reports this
    {
        auto leaf0 =
            ws.get_indexed_leaf<NullifierLeafValue>(WorldStateRevision::committed(), MerkleTreeId::NULLIFIER_TREE, 0);
        EXPECT_EQ(leaf0.has_value(), true);
        EXPECT_EQ(leaf0.value().value, fr(0));

        auto leaf1 =
            ws.get_indexed_leaf<NullifierLeafValue>(WorldStateRevision::committed(), MerkleTreeId::NULLIFIER_TREE, 1);
        EXPECT_EQ(leaf1.has_value(), true);
        EXPECT_EQ(leaf1.value().value, fr(1));

        auto leaf2 =
            ws.get_indexed_leaf<NullifierLeafValue>(WorldStateRevision::committed(), MerkleTreeId::NULLIFIER_TREE, 2);
        EXPECT_EQ(leaf2.has_value(), false);
    }

    {
        auto leaf0 = ws.get_indexed_leaf<PublicDataLeafValue>(
            WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE, 0);
        EXPECT_EQ(leaf0.has_value(), true);
        EXPECT_EQ(leaf0.value().value, PublicDataLeafValue(0, 0));

        auto leaf1 = ws.get_indexed_leaf<PublicDataLeafValue>(
            WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE, 1);
        EXPECT_EQ(leaf1.has_value(), true);
        EXPECT_EQ(leaf1.value().value, PublicDataLeafValue(1, 0));

        auto leaf2 = ws.get_indexed_leaf<PublicDataLeafValue>(
            WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE, 2);
        EXPECT_EQ(leaf2.has_value(), false);
    }
}

TEST_F(WorldStateTest, AppendOnlyTrees)
{
    WorldState ws(1, _directory, 1024);

    std::vector tree_ids{ MerkleTreeId::NOTE_HASH_TREE, MerkleTreeId::L1_TO_L2_MESSAGE_TREE, MerkleTreeId::ARCHIVE };

    for (auto tree_id : tree_ids) {
        TreeInfo initial = ws.get_tree_info(WorldStateRevision::committed(), tree_id);
        assert_leaf_status<fr>(ws, WorldStateRevision::committed(), tree_id, 0, false);

        ws.append_leaves<fr>(tree_id, { fr(42) });
        assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 0, fr(42));
        assert_leaf_status<fr>(ws, WorldStateRevision::committed(), tree_id, 0, false);
        assert_leaf_index(ws, WorldStateRevision::uncommitted(), tree_id, fr(42), 0);

        TreeInfo uncommitted = ws.get_tree_info(WorldStateRevision::uncommitted(), tree_id);
        // uncommitted state diverges from committed state
        EXPECT_EQ(uncommitted.size, initial.size + 1);
        EXPECT_NE(uncommitted.root, initial.root);

        assert_sibling_path(ws, WorldStateRevision::uncommitted(), tree_id, uncommitted.root, fr(42), 0);

        TreeInfo committed = ws.get_tree_info(WorldStateRevision::committed(), tree_id);
        EXPECT_EQ(committed.size, initial.size);
        EXPECT_EQ(committed.root, initial.root);

        ws.commit();
        assert_leaf_value(ws, WorldStateRevision::committed(), tree_id, 0, fr(42));
        assert_leaf_index(ws, WorldStateRevision::committed(), tree_id, fr(42), 0);

        TreeInfo after_commit = ws.get_tree_info(WorldStateRevision::committed(), tree_id);
        // commiting updates the committed state
        EXPECT_EQ(after_commit.size, uncommitted.size);
        EXPECT_EQ(after_commit.root, uncommitted.root);

        assert_sibling_path(ws, WorldStateRevision::committed(), tree_id, after_commit.root, fr(42), 0);

        ws.append_leaves<fr>(tree_id, { fr(43) });
        assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 1, fr(43));
        assert_leaf_status<fr>(ws, WorldStateRevision::committed(), tree_id, 1, false);
        assert_leaf_index(ws, WorldStateRevision::uncommitted(), tree_id, fr(43), 1);

        TreeInfo before_rollback = ws.get_tree_info(WorldStateRevision::uncommitted(), tree_id);
        EXPECT_EQ(before_rollback.size, after_commit.size + 1);
        EXPECT_NE(before_rollback.root, after_commit.root);

        ws.rollback();
        assert_leaf_status<fr>(ws, WorldStateRevision::uncommitted(), tree_id, 1, false);
        assert_leaf_status<fr>(ws, WorldStateRevision::committed(), tree_id, 1, false);

        TreeInfo after_rollback = ws.get_tree_info(WorldStateRevision::committed(), tree_id);
        // rollback restores the committed state
        EXPECT_EQ(after_rollback.size, after_commit.size);
        EXPECT_EQ(after_rollback.root, after_commit.root);
    }
}

TEST_F(WorldStateTest, AppendOnlyAllowDuplicates)
{
    WorldState ws(1, _directory, 1024);

    std::vector tree_ids{ MerkleTreeId::NOTE_HASH_TREE, MerkleTreeId::L1_TO_L2_MESSAGE_TREE, MerkleTreeId::ARCHIVE };

    for (auto tree_id : tree_ids) {
        ws.append_leaves<fr>(tree_id, { fr(42), fr(42) });
        ws.append_leaves<fr>(tree_id, { fr(42) });

        assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 0, fr(42));
        assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 1, fr(42));
        assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 2, fr(42));

        ws.commit();

        assert_leaf_value(ws, WorldStateRevision::committed(), tree_id, 0, fr(42));
        assert_leaf_value(ws, WorldStateRevision::committed(), tree_id, 1, fr(42));
        assert_leaf_value(ws, WorldStateRevision::committed(), tree_id, 2, fr(42));
    }
}

TEST_F(WorldStateTest, NullifierTree)
{
    WorldState ws(1, _directory, 1024);
    auto tree_id = MerkleTreeId::NULLIFIER_TREE;
    NullifierLeafValue test_nullifier(42);

    auto predecessor_of_42 =
        ws.find_indexed_leaf_predecessor<NullifierLeafValue>(WorldStateRevision::committed(), tree_id, test_nullifier);
    EXPECT_EQ(predecessor_of_42, IndexedLeaf(NullifierLeafValue(1), 0, 0));

    ws.append_leaves<NullifierLeafValue>(tree_id, { test_nullifier });
    assert_leaf_value(ws, WorldStateRevision::uncommitted(), tree_id, 2, test_nullifier);
    assert_leaf_status<NullifierLeafValue>(ws, WorldStateRevision::committed(), tree_id, 2, false);

    ws.commit();

    auto test_leaf = ws.get_indexed_leaf<NullifierLeafValue>(WorldStateRevision::committed(), tree_id, 2);
    // at this point 42 should be the biggest leaf so it wraps back to 0
    EXPECT_EQ(test_leaf.value(), IndexedLeaf(test_nullifier, 0, 0));

    auto predecessor_of_42_again =
        ws.find_indexed_leaf_predecessor<NullifierLeafValue>(WorldStateRevision::committed(), tree_id, test_nullifier);
    EXPECT_EQ(predecessor_of_42_again, IndexedLeaf(NullifierLeafValue(42), 0, 0));

    auto predecessor_of_43 = ws.find_indexed_leaf_predecessor<NullifierLeafValue>(
        WorldStateRevision::committed(), tree_id, NullifierLeafValue(43));
    EXPECT_EQ(predecessor_of_43, IndexedLeaf(NullifierLeafValue(42), 0, 0));

    auto info = ws.get_tree_info(WorldStateRevision::committed(), tree_id);
    assert_sibling_path(ws,
                        WorldStateRevision::committed(),
                        tree_id,
                        info.root,
                        HashPolicy::hash(test_leaf.value().get_hash_inputs()),
                        2);
}

TEST_F(WorldStateTest, NullifierTreeDuplicates)
{
    WorldState ws(1, _directory, 1024);
    auto tree_id = MerkleTreeId::NULLIFIER_TREE;
    NullifierLeafValue test_nullifier(42);

    ws.append_leaves<NullifierLeafValue>(tree_id, { test_nullifier });
    ws.commit();

    assert_tree_size(ws, WorldStateRevision::committed(), tree_id, 3);
    EXPECT_THROW(ws.append_leaves<NullifierLeafValue>(tree_id, { test_nullifier }), std::runtime_error);
    assert_tree_size(ws, WorldStateRevision::committed(), tree_id, 3);
    assert_leaf_status<NullifierLeafValue>(ws, WorldStateRevision::committed(), tree_id, 4, false);
}

TEST_F(WorldStateTest, NullifierBatchInsert)
{
    WorldState ws(1, _directory, 1024);
    auto response = ws.batch_insert_indexed_leaves<NullifierLeafValue>(
        MerkleTreeId::NULLIFIER_TREE, { NullifierLeafValue(50), NullifierLeafValue(42), NullifierLeafValue(80) });

    std::vector<std::pair<NullifierLeafValue, size_t>> expected_sorted_leaves = { { NullifierLeafValue(80), 2 },
                                                                                  { NullifierLeafValue(50), 0 },
                                                                                  { NullifierLeafValue(42), 1 } };
    EXPECT_EQ(response.sorted_leaves, expected_sorted_leaves);

    {
        // insertion happens in descending order, but keeping original indices
        // first insert leaf 80, at index 4 (tree had size 2, 80 is on index 2 => 2 + 2 = 4)
        // predecessor will be 1, currently linked to head of the list (0)
        auto low_leaf = response.low_leaf_witness_data[0];
        auto expected_low_leaf = IndexedLeaf(NullifierLeafValue(1), 0, fr(0));
        EXPECT_EQ(low_leaf.index, 1);
        EXPECT_EQ(low_leaf.leaf, expected_low_leaf);
    }

    {
        // insert 50 on position 2 (2 + 0 = 2)
        // predecessor will be 1 linked to 80
        auto low_leaf = response.low_leaf_witness_data[1];
        auto expected_low_leaf = IndexedLeaf(NullifierLeafValue(1), 4, fr(80));
        EXPECT_EQ(low_leaf.index, 1);
        EXPECT_EQ(low_leaf.leaf, expected_low_leaf);
    }

    {
        // finally, insert 42 on position 3 (2 + 1 = 3)
        // prededecessor will be 1 linked to 50
        auto low_leaf = response.low_leaf_witness_data[2];
        auto expected_low_leaf = IndexedLeaf(NullifierLeafValue(1), 2, fr(50));
        EXPECT_EQ(low_leaf.index, 1);
        EXPECT_EQ(low_leaf.leaf, expected_low_leaf);
    }
}

TEST_F(WorldStateTest, PublicDataTree)
{
    WorldState ws(1, _directory, 1024);

    ws.append_leaves(MerkleTreeId::PUBLIC_DATA_TREE, std::vector{ PublicDataLeafValue(42, 0) });
    assert_tree_size(ws, WorldStateRevision::uncommitted(), MerkleTreeId::PUBLIC_DATA_TREE, 3);

    auto leaf =
        ws.get_indexed_leaf<PublicDataLeafValue>(WorldStateRevision::uncommitted(), MerkleTreeId::PUBLIC_DATA_TREE, 2);
    EXPECT_EQ(leaf.value().value, PublicDataLeafValue(42, 0));

    ws.update_public_data(PublicDataLeafValue(42, 1));
    // assert_tree_size(ws, WorldStateRevision::uncommitted(), MerkleTreeId::PUBLIC_DATA_TREE, 3);

    leaf =
        ws.get_indexed_leaf<PublicDataLeafValue>(WorldStateRevision::uncommitted(), MerkleTreeId::PUBLIC_DATA_TREE, 2);
    EXPECT_EQ(leaf.value().value, PublicDataLeafValue(42, 1));

    ws.commit();

    leaf = ws.get_indexed_leaf<PublicDataLeafValue>(WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE, 2);
    EXPECT_EQ(leaf.value().value, PublicDataLeafValue(42, 1));
    // assert_tree_size(ws, WorldStateRevision::committed(), MerkleTreeId::PUBLIC_DATA_TREE, 3);
}
