#pragma once

#include <cstdint>
#include <ostream>
#include <variant>

namespace bb::world_state {

struct SpecificBlock {
    uint32_t block_number;
};

inline std::ostream& operator<<(std::ostream& os, const SpecificBlock& b)
{
    return os << "SpecificBlock{ " << b.block_number << " }";
};

struct LatestBlock {};
inline std::ostream& operator<<(std::ostream& os, const LatestBlock&)
{
    return os << "LatestBlock";
};

struct UncomittedBlock {};
inline std::ostream& operator<<(std::ostream& os, const UncomittedBlock&)
{
    return os << "UncomittedBlock";
};

using BlockSpecifier = std::variant<LatestBlock, SpecificBlock, UncomittedBlock>;

} // namespace bb::world_state
