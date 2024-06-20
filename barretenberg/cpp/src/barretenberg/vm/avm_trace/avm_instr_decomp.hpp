#pragma once

#include <vector>

#include "barretenberg/relations/generated/avm/instr_decomp.hpp"
#include "barretenberg/vm/avm_trace/avm_common.hpp"
#include "barretenberg/vm/avm_trace/avm_instructions.hpp"
#include "barretenberg/vm/avm_trace/avm_opcode.hpp"

namespace bb::avm_trace {

class AvmInstructionDecompositonBuilder {
  public:
    using InstructionDecompositionRow = bb::Avm_vm::Instr_decompRow<FF>;

    AvmInstructionDecompositonBuilder(const std::vector<Instruction>& instructions);

    const std::vector<InstructionDecompositionRow>& rows() const { return instruction_decomposition; }

  private:
    std::vector<InstructionDecompositionRow> instruction_decomposition;
};

template <typename DestRow>
void merge_into(DestRow& dest, AvmInstructionDecompositonBuilder::InstructionDecompositionRow const& src)
{
    dest.instr_decomp_indirect = src.instr_decomp_indirect;
    dest.instr_decomp_o1 = src.instr_decomp_o1;
    dest.instr_decomp_o2 = src.instr_decomp_o2;
    dest.instr_decomp_o3 = src.instr_decomp_o3;
    dest.instr_decomp_o4 = src.instr_decomp_o4;
    dest.instr_decomp_o5 = src.instr_decomp_o5;
    dest.instr_decomp_o6 = src.instr_decomp_o6;
    dest.instr_decomp_o7 = src.instr_decomp_o7;
    dest.instr_decomp_opcode_val = src.instr_decomp_opcode_val;
    dest.instr_decomp_sel_decomposition = src.instr_decomp_sel_decomposition;
    dest.instr_decomp_tag = src.instr_decomp_tag;
}

} // namespace bb::avm_trace
