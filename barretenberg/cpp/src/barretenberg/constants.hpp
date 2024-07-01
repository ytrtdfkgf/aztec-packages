#pragma once
#include <cstdint>

namespace bb {
// The log of the max circuit size assumed in order to achieve constant sized proofs
static constexpr uint32_t CONST_PROOF_SIZE_LOG_N = 25;
} // namespace bb