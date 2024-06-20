#pragma once

#include <cstddef>
#include <vector>

#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/relations/generated/avm/instr_spec.hpp"
#include "barretenberg/vm/avm_trace/avm_common.hpp"
#include "barretenberg/vm/avm_trace/avm_opcode.hpp"

namespace bb::avm_trace {

class FixedInstructionSpecTable {
  public:
    using InstrSpecRow = bb::Avm_vm::Instr_specRow<FF>;

    static const FixedInstructionSpecTable& get();

    size_t size() const { return table_rows.size(); }
    const InstrSpecRow& at(size_t i) const { return table_rows.at(i); }
    const InstrSpecRow& at(OpCode o) const { return at(static_cast<size_t>(o)); }

  private:
    FixedInstructionSpecTable();

    std::vector<InstrSpecRow> table_rows;
};

template <typename DestRow> void merge_into(DestRow& dest, FixedInstructionSpecTable::InstrSpecRow const& src)
{
    dest.instr_spec_sel_instr_spec = src.instr_spec_sel_instr_spec;

    dest.instr_spec_l2_gas_op_cost = src.instr_spec_l2_gas_op_cost;
    dest.instr_spec_da_gas_op_cost = src.instr_spec_da_gas_op_cost;

    dest.instr_spec_sel_op_sender = src.instr_spec_sel_op_sender;
    dest.instr_spec_sel_op_address = src.instr_spec_sel_op_address;
    dest.instr_spec_sel_op_storage_address = src.instr_spec_sel_op_storage_address;
    dest.instr_spec_sel_op_chain_id = src.instr_spec_sel_op_chain_id;
    dest.instr_spec_sel_op_version = src.instr_spec_sel_op_version;
    dest.instr_spec_sel_op_block_number = src.instr_spec_sel_op_block_number;
    dest.instr_spec_sel_op_coinbase = src.instr_spec_sel_op_coinbase;
    dest.instr_spec_sel_op_timestamp = src.instr_spec_sel_op_timestamp;
    dest.instr_spec_sel_op_fee_per_l2_gas = src.instr_spec_sel_op_fee_per_l2_gas;
    dest.instr_spec_sel_op_fee_per_da_gas = src.instr_spec_sel_op_fee_per_da_gas;
    dest.instr_spec_sel_op_transaction_fee = src.instr_spec_sel_op_transaction_fee;
    dest.instr_spec_sel_op_l2gasleft = src.instr_spec_sel_op_l2gasleft;
    dest.instr_spec_sel_op_dagasleft = src.instr_spec_sel_op_dagasleft;
    dest.instr_spec_sel_op_note_hash_exists = src.instr_spec_sel_op_note_hash_exists;
    dest.instr_spec_sel_op_emit_note_hash = src.instr_spec_sel_op_emit_note_hash;
    dest.instr_spec_sel_op_nullifier_exists = src.instr_spec_sel_op_nullifier_exists;
    dest.instr_spec_sel_op_emit_nullifier = src.instr_spec_sel_op_emit_nullifier;
    dest.instr_spec_sel_op_l1_to_l2_msg_exists = src.instr_spec_sel_op_l1_to_l2_msg_exists;
    dest.instr_spec_sel_op_emit_unencrypted_log = src.instr_spec_sel_op_emit_unencrypted_log;
    dest.instr_spec_sel_op_emit_l2_to_l1_msg = src.instr_spec_sel_op_emit_l2_to_l1_msg;
    dest.instr_spec_sel_op_get_contract_instance = src.instr_spec_sel_op_get_contract_instance;
    dest.instr_spec_sel_op_sload = src.instr_spec_sel_op_sload;
    dest.instr_spec_sel_op_sstore = src.instr_spec_sel_op_sstore;
    dest.instr_spec_sel_op_radix_le = src.instr_spec_sel_op_radix_le;
    dest.instr_spec_sel_op_sha256 = src.instr_spec_sel_op_sha256;
    dest.instr_spec_sel_op_poseidon2 = src.instr_spec_sel_op_poseidon2;
    dest.instr_spec_sel_op_keccak = src.instr_spec_sel_op_keccak;
    dest.instr_spec_sel_op_pedersen = src.instr_spec_sel_op_pedersen;
    dest.instr_spec_sel_op_add = src.instr_spec_sel_op_add;
    dest.instr_spec_sel_op_sub = src.instr_spec_sel_op_sub;
    dest.instr_spec_sel_op_mul = src.instr_spec_sel_op_mul;
    dest.instr_spec_sel_op_div = src.instr_spec_sel_op_div;
    dest.instr_spec_sel_op_fdiv = src.instr_spec_sel_op_fdiv;
    dest.instr_spec_sel_op_not = src.instr_spec_sel_op_not;
    dest.instr_spec_sel_op_eq = src.instr_spec_sel_op_eq;
    dest.instr_spec_sel_op_and = src.instr_spec_sel_op_and;
    dest.instr_spec_sel_op_or = src.instr_spec_sel_op_or;
    dest.instr_spec_sel_op_xor = src.instr_spec_sel_op_xor;
    dest.instr_spec_sel_op_cast = src.instr_spec_sel_op_cast;
    dest.instr_spec_sel_op_lt = src.instr_spec_sel_op_lt;
    dest.instr_spec_sel_op_lte = src.instr_spec_sel_op_lte;
    dest.instr_spec_sel_op_shl = src.instr_spec_sel_op_shl;
    dest.instr_spec_sel_op_shr = src.instr_spec_sel_op_shr;
    dest.instr_spec_sel_op_internal_call = src.instr_spec_sel_op_internal_call;
    dest.instr_spec_sel_op_internal_return = src.instr_spec_sel_op_internal_return;
    dest.instr_spec_sel_op_jump = src.instr_spec_sel_op_jump;
    dest.instr_spec_sel_op_jumpi = src.instr_spec_sel_op_jumpi;
    dest.instr_spec_sel_op_halt = src.instr_spec_sel_op_halt;
    dest.instr_spec_sel_op_external_call = src.instr_spec_sel_op_external_call;
    dest.instr_spec_sel_op_mov = src.instr_spec_sel_op_mov;
    dest.instr_spec_sel_op_cmov = src.instr_spec_sel_op_cmov;

    // add or autogen the rest
}

} // namespace bb::avm_trace