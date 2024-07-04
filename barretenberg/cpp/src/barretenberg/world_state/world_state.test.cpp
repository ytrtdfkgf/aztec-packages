#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/fixtures.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include <filesystem>
#include <gtest/gtest.h>

using namespace bb::world_state;

class WorldStateTest : public testing::Test {
  protected:
    void SetUp() override
    {
        // setup with 1MB max db size, 1 max database and 2 maximum concurrent readers
        _directory = bb::crypto::merkle_tree::randomTempDirectory();
        std::filesystem::create_directories(_directory);
    }

    void TearDown() override { std::filesystem::remove_all(_directory); }

    static std::string _directory;
};

std::string WorldStateTest::_directory;

TEST_F(WorldStateTest, GetInitialTreeInfoForAllTrees)
{
    WorldState ws(1, _directory, 1024);

    {
        auto info = ws.get_tree_info(MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(info.id, MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(info.size, 2);
        EXPECT_EQ(info.depth, NULLIFIER_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x22c4533ddff9ecb72bfc3e762e9d63f17ddd474ae180857ef4656f127c4c848e"));
    }

    {
        auto info = ws.get_tree_info(MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(info.id, MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, NOTE_HASH_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x16642d9ccd8346c403aa4c3fa451178b22534a27035cdaa6ec34ae53b29c50cb"));
    }

    {
        auto info = ws.get_tree_info(MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(info.id, MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(info.size, 2);
        EXPECT_EQ(info.depth, PUBLIC_DATA_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x25dc2dfffc26f14b1ac05d5d74a912931b59ca8098d3b3b8cdc0d3da40421b1c"));
    }

    {
        auto info = ws.get_tree_info(MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(info.id, MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, L1_TO_L2_MSG_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }

    {
        auto info = ws.get_tree_info(MerkleTreeId::ARCHIVE);
        EXPECT_EQ(info.id, MerkleTreeId::ARCHIVE);
        EXPECT_EQ(info.size, 0);
        EXPECT_EQ(info.depth, ARCHIVE_TREE_HEIGHT);
        EXPECT_EQ(info.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }
}

TEST_F(WorldStateTest, GetInitialStateReference)
{
    WorldState ws(1, _directory, 1024);
    auto state_ref = ws.get_state_reference();

    EXPECT_EQ(state_ref.snapshots.size(), 5);

    {
        auto snapshot = state_ref.snapshots.at(MerkleTreeId::NULLIFIER_TREE);
        EXPECT_EQ(snapshot.size, 2);
        EXPECT_EQ(snapshot.root, bb::fr("0x22c4533ddff9ecb72bfc3e762e9d63f17ddd474ae180857ef4656f127c4c848e"));
    }

    {
        auto snapshot = state_ref.snapshots.at(MerkleTreeId::NOTE_HASH_TREE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x16642d9ccd8346c403aa4c3fa451178b22534a27035cdaa6ec34ae53b29c50cb"));
    }

    {
        auto snapshot = state_ref.snapshots.at(MerkleTreeId::PUBLIC_DATA_TREE);
        EXPECT_EQ(snapshot.size, 2);
        EXPECT_EQ(snapshot.root, bb::fr("0x25dc2dfffc26f14b1ac05d5d74a912931b59ca8098d3b3b8cdc0d3da40421b1c"));
    }

    {
        auto snapshot = state_ref.snapshots.at(MerkleTreeId::L1_TO_L2_MESSAGE_TREE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }

    {
        auto snapshot = state_ref.snapshots.at(MerkleTreeId::ARCHIVE);
        EXPECT_EQ(snapshot.size, 0);
        EXPECT_EQ(snapshot.root, bb::fr("0x1864fcdaa80ff2719154fa7c8a9050662972707168d69eac9db6fd3110829f80"));
    }
}

TEST_F(WorldStateTest, GetNullifierLeaf)
{
    WorldState ws(1, _directory, 1024);

    auto definitely_no_leaf =
        ws.get_leaf_preimage<bb::crypto::merkle_tree::NullifierLeafValue>(MerkleTreeId::NULLIFIER_TREE, 3);
    EXPECT_EQ(definitely_no_leaf.has_value(), false);

    std::vector<bb::crypto::merkle_tree::NullifierLeafValue> leaves{ bb::crypto::merkle_tree::NullifierLeafValue(30) };

    ws.append_leaves(MerkleTreeId::NULLIFIER_TREE, leaves);
    ws.commit();
    auto maybe_leaf =
        ws.get_leaf_preimage<bb::crypto::merkle_tree::NullifierLeafValue>(MerkleTreeId::NULLIFIER_TREE, 2);
    EXPECT_TRUE(maybe_leaf.has_value());
    EXPECT_EQ(maybe_leaf.value(), bb::fr(30));
}

TEST_F(WorldStateTest, GetNoteHashLeaf)
{
    WorldState ws(1, _directory, 1024);

    // auto definitely_no_leaf = ws.get_leaf_preimage<bb::fr>(MerkleTreeId::NOTE_HASH_TREE, 0);
    // EXPECT_EQ(definitely_no_leaf.has_value(), false);

    std::vector<bb::fr> leaves{ bb::fr("0x0000000000000000000000000000000000000000000000000000000000000042") };

    ws.append_leaves(MerkleTreeId::NOTE_HASH_TREE, leaves);
    // auto maybe_leaf = ws.get_leaf_preimage<bb::fr>(MerkleTreeId::NOTE_HASH_TREE, 0);
    // EXPECT_TRUE(maybe_leaf.has_value());
    // EXPECT_EQ(maybe_leaf.value(), bb::fr("0x0000000000000000000000000000000000000000000000000000000000000042"));
}
