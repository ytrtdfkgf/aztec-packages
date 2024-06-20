#pragma once

#include "barretenberg/numeric/uint128/uint128.hpp"
#include "barretenberg/vm/avm_trace/avm_common.hpp"
#include "barretenberg/vm/avm_trace/avm_opcode.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace bb::avm_trace {

using Operand = std::variant<uint8_t, uint16_t, uint32_t, uint64_t, uint128_t>;

class Instruction {
  public:
    OpCode op_code;
    std::optional<AvmMemoryTag> tag;
    std::optional<uint8_t> indirect;
    std::vector<Operand> operands;

    Instruction() = delete;
    explicit Instruction(OpCode op_code,
                         std::optional<AvmMemoryTag> tag,
                         std::optional<uint8_t> indirect,
                         std::vector<Operand> operands)
        : op_code(op_code)
        , tag(tag)
        , indirect(indirect)
        , operands(std::move(operands)){};

    std::string to_string() const
    {
        std::string str = bb::avm_trace::to_string(op_code);

        if (tag.has_value()) {
            str += std::to_string(static_cast<int>(tag.value())) + " ";
        }
        if (indirect.has_value()) {
            str += std::to_string(indirect.value()) + " ";
        }

        for (const auto& operand : operands) {
            str += " ";
            if (std::holds_alternative<uint8_t>(operand)) {
                str += std::to_string(std::get<uint8_t>(operand));
            } else if (std::holds_alternative<uint16_t>(operand)) {
                str += std::to_string(std::get<uint16_t>(operand));
            } else if (std::holds_alternative<uint32_t>(operand)) {
                str += std::to_string(std::get<uint32_t>(operand));
            } else if (std::holds_alternative<uint64_t>(operand)) {
                str += std::to_string(std::get<uint64_t>(operand));
            } else if (std::holds_alternative<uint128_t>(operand)) {
                str += "someu128";
            } else {
                str += "unknown operand type";
            }
        }
        return str;
    }
};

} // namespace bb::avm_trace
