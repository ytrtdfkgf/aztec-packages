#pragma once

#include <cstdint>
#include <variant>

namespace bb::world_state {

struct WorldStateRevision {
    struct HistoricalBlock {
        const uint32_t block;
    };

    struct CurrentState {
        const bool uncommitted;
    };

    using State = std::variant<WorldStateRevision::HistoricalBlock, WorldStateRevision::CurrentState>;
    const State state;

    static WorldStateRevision committed() { return { CurrentState{ false } }; }
    static WorldStateRevision uncommitted() { return { CurrentState{ true } }; }
    static WorldStateRevision at_block(uint32_t block_number) { return { HistoricalBlock{ block_number } }; }
};

} // namespace bb::world_state
