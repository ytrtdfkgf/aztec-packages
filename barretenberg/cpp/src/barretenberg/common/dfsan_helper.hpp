#pragma once
#include "barretenberg/common/throw_or_abort.hpp"
#include <cstddef>
#include <sanitizer/dfsan_interface.h>
constexpr size_t TRANSCRIPT_SHIFT_IS_SUBMITTED_FIRST_HALF = 1;
constexpr size_t TRANSCRIPT_SHIFT_IS_CHALLENGE_FIRST_HALF = 2;
constexpr size_t TRANSCRIPT_SHIFT_IS_SUBMITTED_SECOND_HALF = 3;
constexpr size_t TRANSCRIPT_SHIFT_IS_CHALLENGE_SECOND_HALF = 4;

template <typename T> constexpr void check_tainted_value(const T& input)
{
    if (!std::is_constant_evaluated()) {
        dfsan_label value_label = dfsan_read_label(&input, sizeof(T));
        constexpr dfsan_label dangerous_interaction_label_1 =
            (1 << TRANSCRIPT_SHIFT_IS_CHALLENGE_FIRST_HALF) | (1 << TRANSCRIPT_SHIFT_IS_SUBMITTED_SECOND_HALF);
        constexpr dfsan_label dangerous_interaction_label_2 =
            dangerous_interaction_label_1 | (1 << TRANSCRIPT_SHIFT_IS_CHALLENGE_SECOND_HALF);
        if (value_label == dangerous_interaction_label_1 || value_label == dangerous_interaction_label_2) {
            // dfsan_print_origin_trace(&in, "The trace of the offending variable");
            throw_or_abort("Dangerous transcript interaction detected");
        }
    }
}