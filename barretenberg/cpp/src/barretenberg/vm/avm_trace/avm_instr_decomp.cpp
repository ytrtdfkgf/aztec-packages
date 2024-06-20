#include "barretenberg/vm/avm_trace/avm_instr_decomp.hpp"
#include "barretenberg/common/assert.hpp"
#include "barretenberg/numeric/uint128/uint128.hpp"
#include "barretenberg/numeric/uint256/uint256.hpp"
#include "barretenberg/vm/avm_trace/avm_common.hpp"

namespace bb::avm_trace {
namespace {

FF operand_as_ff(const Operand& operand)
{
    if (std::holds_alternative<uint8_t>(operand)) {
        return FF(std::get<uint8_t>(operand));
    } else if (std::holds_alternative<uint16_t>(operand)) {
        return FF(std::get<uint16_t>(operand));
    } else if (std::holds_alternative<uint32_t>(operand)) {
        return FF(std::get<uint32_t>(operand));
    } else if (std::holds_alternative<uint64_t>(operand)) {
        return FF(std::get<uint64_t>(operand));
    } else if (std::holds_alternative<uint128_t>(operand)) {
        return FF(uint256_t::from_uint128(std::get<uint128_t>(operand)));
    }

    // Should never reach here.
    ASSERT(false);
    return FF::zero();
}

} // namespace

AvmInstructionDecompositonBuilder::AvmInstructionDecompositonBuilder(const std::vector<Instruction>& instructions)
{
    instruction_decomposition.reserve(instructions.size());
    for (const auto& instr : instructions) {
        const auto extract_operand = [&](size_t i) {
            return instr.operands.size() > i ? operand_as_ff(instr.operands[i]) : FF::zero();
        };

        instruction_decomposition.emplace_back(InstructionDecompositionRow{
            .instr_decomp_indirect = FF(instr.indirect.value_or(0)),
            .instr_decomp_o1 = extract_operand(0),
            .instr_decomp_o2 = extract_operand(1),
            .instr_decomp_o3 = extract_operand(2),
            .instr_decomp_o4 = extract_operand(3),
            .instr_decomp_o5 = extract_operand(4),
            .instr_decomp_o6 = extract_operand(5),
            .instr_decomp_o7 = extract_operand(6),
            .instr_decomp_opcode_val = FF(static_cast<int>(instr.op_code)),
            .instr_decomp_sel_decomposition = FF::one(),
            .instr_decomp_tag = FF(static_cast<int>(instr.tag.value_or(AvmMemoryTag::U0))),
        });
    }
}

} // namespace bb::avm_trace
