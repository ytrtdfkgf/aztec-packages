#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/crypto/merkle_tree/fixtures.hpp"
#include "barretenberg/world_state/block_specifier.hpp"
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

TEST_F(WorldStateTest, works)
{
    WorldState ws(1, _directory, 1024);
    auto m = ws.get_tree_info(SpecificBlock{ 5 }, MerkleTreeId::NOTE_HASH_TREE);

    std::cout << "root: " << m.root << "\n"
              << "size: " << m.size << "\n"
              << "depth: " << m.depth << "\n";

    // EXPECT_EQ(m.name, "nullifier_tree");
}
