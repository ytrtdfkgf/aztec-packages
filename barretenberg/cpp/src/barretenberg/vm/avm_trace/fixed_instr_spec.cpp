#include "barretenberg/vm/avm_trace/fixed_instr_spec.hpp"

#include <unordered_map>

#include "barretenberg/vm/avm_trace/avm_opcode.hpp"

namespace bb::avm_trace {

namespace {

using InstrSpecRow = FixedInstructionSpecTable::InstrSpecRow;

struct InstrSpecEntry {
    FF InstrSpecRow::*op_selector;
    FF sel_mem_op_a;
    FF sel_mem_op_b;
    FF sel_mem_op_c;
    FF sel_mem_op_d;
    FF sel_resolve_ind_addr_a;
    FF sel_resolve_ind_addr_b;
    FF sel_resolve_ind_addr_c;
    FF sel_resolve_ind_addr_d;
    FF rwa;
    FF rwb;
    FF rwc;
    FF rwd;
    FF InstrSpecRow::*chiplet_selector;
};

const std::unordered_map<OpCode, InstrSpecEntry> OPCODE_TO_SELECTOR = {
    { OpCode::SENDER, { .op_selector = &InstrSpecRow::instr_spec_sel_op_sender } },
    { OpCode::ADDRESS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_address } },
    { OpCode::STORAGEADDRESS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_storage_address } },
    { OpCode::CHAINID, { .op_selector = &InstrSpecRow::instr_spec_sel_op_chain_id } },
    { OpCode::VERSION, { .op_selector = &InstrSpecRow::instr_spec_sel_op_version } },
    { OpCode::BLOCKNUMBER, { .op_selector = &InstrSpecRow::instr_spec_sel_op_block_number } },
    { OpCode::COINBASE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_coinbase } },
    { OpCode::TIMESTAMP, { .op_selector = &InstrSpecRow::instr_spec_sel_op_timestamp } },
    { OpCode::FEEPERL2GAS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_fee_per_l2_gas } },
    { OpCode::FEEPERDAGAS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_fee_per_da_gas } },
    { OpCode::TRANSACTIONFEE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_transaction_fee } },
    { OpCode::L2GASLEFT, { .op_selector = &InstrSpecRow::instr_spec_sel_op_l2gasleft } },
    { OpCode::DAGASLEFT, { .op_selector = &InstrSpecRow::instr_spec_sel_op_dagasleft } },
    { OpCode::NOTEHASHEXISTS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_note_hash_exists } },
    { OpCode::EMITNOTEHASH, { .op_selector = &InstrSpecRow::instr_spec_sel_op_emit_note_hash } },
    { OpCode::NULLIFIEREXISTS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_nullifier_exists } },
    { OpCode::EMITNULLIFIER, { .op_selector = &InstrSpecRow::instr_spec_sel_op_emit_nullifier } },
    { OpCode::L1TOL2MSGEXISTS, { .op_selector = &InstrSpecRow::instr_spec_sel_op_l1_to_l2_msg_exists } },
    { OpCode::EMITUNENCRYPTEDLOG, { .op_selector = &InstrSpecRow::instr_spec_sel_op_emit_unencrypted_log } },
    { OpCode::SENDL2TOL1MSG, { .op_selector = &InstrSpecRow::instr_spec_sel_op_emit_l2_to_l1_msg } }, // name mismatch
    { OpCode::GETCONTRACTINSTANCE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_get_contract_instance } },
    { OpCode::SLOAD, { .op_selector = &InstrSpecRow::instr_spec_sel_op_sload } },
    { OpCode::SSTORE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_sstore } },
    { OpCode::TORADIXLE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_radix_le } }, // name mismatch
    { OpCode::SHA256, { .op_selector = &InstrSpecRow::instr_spec_sel_op_sha256 } },
    { OpCode::POSEIDON2, { .op_selector = &InstrSpecRow::instr_spec_sel_op_poseidon2 } },
    { OpCode::KECCAK, { .op_selector = &InstrSpecRow::instr_spec_sel_op_keccak } },
    { OpCode::PEDERSEN, { .op_selector = &InstrSpecRow::instr_spec_sel_op_pedersen } },
    { OpCode::ADD, { .op_selector = &InstrSpecRow::instr_spec_sel_op_add } },
    { OpCode::SUB, { .op_selector = &InstrSpecRow::instr_spec_sel_op_sub } },
    { OpCode::MUL, { .op_selector = &InstrSpecRow::instr_spec_sel_op_mul } },
    { OpCode::DIV, { .op_selector = &InstrSpecRow::instr_spec_sel_op_div } },
    { OpCode::FDIV, { .op_selector = &InstrSpecRow::instr_spec_sel_op_fdiv } },
    { OpCode::NOT, { .op_selector = &InstrSpecRow::instr_spec_sel_op_not } },
    { OpCode::EQ, { .op_selector = &InstrSpecRow::instr_spec_sel_op_eq } },
    { OpCode::AND, { .op_selector = &InstrSpecRow::instr_spec_sel_op_and } },
    { OpCode::OR, { .op_selector = &InstrSpecRow::instr_spec_sel_op_or } },
    { OpCode::XOR, { .op_selector = &InstrSpecRow::instr_spec_sel_op_xor } },
    { OpCode::CAST, { .op_selector = &InstrSpecRow::instr_spec_sel_op_cast } },
    { OpCode::LT, { .op_selector = &InstrSpecRow::instr_spec_sel_op_lt } },
    { OpCode::LTE, { .op_selector = &InstrSpecRow::instr_spec_sel_op_lte } },
    { OpCode::SHL, { .op_selector = &InstrSpecRow::instr_spec_sel_op_shl } },
    { OpCode::SHR, { .op_selector = &InstrSpecRow::instr_spec_sel_op_shr } },
    { OpCode::INTERNALCALL, { .op_selector = &InstrSpecRow::instr_spec_sel_op_internal_call } },
    { OpCode::INTERNALRETURN, { .op_selector = &InstrSpecRow::instr_spec_sel_op_internal_return } },
    { OpCode::JUMP, { .op_selector = &InstrSpecRow::instr_spec_sel_op_jump } },
    { OpCode::JUMPI, { .op_selector = &InstrSpecRow::instr_spec_sel_op_jumpi } },
    { OpCode::RETURN, { .op_selector = &InstrSpecRow::instr_spec_sel_op_halt } },        // name mismatch
    { OpCode::CALL, { .op_selector = &InstrSpecRow::instr_spec_sel_op_external_call } }, // name mismatch
    { OpCode::MOV, { .op_selector = &InstrSpecRow::instr_spec_sel_op_mov } },
    { OpCode::CMOV, { .op_selector = &InstrSpecRow::instr_spec_sel_op_cmov } }
};

} // namespace

FixedInstructionSpecTable::FixedInstructionSpecTable()
{
    const size_t num_rows = static_cast<int>(OpCode::LAST_OPCODE_SENTINEL);
    table_rows.resize(num_rows);

    for (auto& row : table_rows) {
        row.instr_spec_sel_instr_spec = FF(1);

        // Gas costs.
        row.instr_spec_l2_gas_op_cost = FF(10);
        row.instr_spec_da_gas_op_cost = FF(2);
    }

    for (size_t i = 0; i < table_rows.size(); i++) {
        // Temporary
        if (!OPCODE_TO_SELECTOR.contains(static_cast<OpCode>(i))) {
            throw std::runtime_error("Missing opcode " + std::to_string(i) + " in FixedInstructionSpecTable");
        }

        // Fill in the right selector for this opcode.
        const InstrSpecEntry& spec = OPCODE_TO_SELECTOR.at(static_cast<OpCode>(i));
        auto& row = table_rows[i];
        row.*spec.op_selector = FF(1);
        row.*spec.chiplet_selector = FF(1);
    }
}

// Singleton.
const FixedInstructionSpecTable& FixedInstructionSpecTable::get()
{
    static FixedInstructionSpecTable table;
    return table;
}

} // namespace bb::avm_trace