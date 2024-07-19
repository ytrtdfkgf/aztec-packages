#pragma once

#include "barretenberg/crypto/poseidon2/poseidon2.hpp"
#include "barretenberg/stdlib/hash/poseidon2/poseidon2.hpp"
#include "barretenberg/stdlib/primitives/field/field_conversion.hpp"
#include "barretenberg/transcript/transcript.hpp"

namespace bb::stdlib::recursion::honk {

template <typename Builder> struct StdlibTranscriptParams {
    using Fr = stdlib::field_t<Builder>;
    using Proof = std::vector<Fr>;
    static inline Fr hash(const std::vector<Fr>& data)
    {
#ifdef DATAFLOW_SANITIZER
        std::vector<dfsan_label> original_labels;
        for (auto& element : data) {
            original_labels.push_back(dfsan_get_witness_label(element));
            dfsan_set_witness_label(element, 0);
        }
        auto restore_labels = [&]() {
            for (size_t i = 0; i < data.size(); i++) {
                dfsan_set_witness_label(data[i], original_labels[i]);
            }
        };
#endif
        if constexpr (std::is_same_v<Builder, MegaCircuitBuilder>) {
            ASSERT(!data.empty() && data[0].get_context() != nullptr);
            Builder* builder = data[0].get_context();
            auto result = stdlib::poseidon2<Builder>::hash(*builder, data);
#ifdef DATAFLOW_SANITIZER
            restore_labels();
#endif
            return result;
        } else {
            // TODO(https://github.com/AztecProtocol/barretenberg/issues/1035): Add constraints for hashing in Ultra
            using NativeFr = bb::fr;
            ASSERT(!data.empty() && data[0].get_context() != nullptr);
            Builder* builder = data[0].get_context();

            // call the native hash on the data
            std::vector<NativeFr> native_data;
            native_data.reserve(data.size());
            for (const auto& fr : data) {
                native_data.push_back(fr.get_value());
            }
            NativeFr hash_value = crypto::Poseidon2<crypto::Poseidon2Bn254ScalarFieldParams>::hash(native_data);

            Fr hash_field_ct = Fr::from_witness(builder, hash_value);
#ifdef DATAFLOW_SANITIZER
            restore_labels();
#endif
            return hash_field_ct;
        }
    }
    template <typename T> static inline T convert_challenge(const Fr& challenge)
    {
        Builder* builder = challenge.get_context();
        return bb::stdlib::field_conversion::convert_challenge<Builder, T>(*builder, challenge);
    }
    template <typename T> static constexpr size_t calc_num_bn254_frs()
    {
        return bb::stdlib::field_conversion::calc_num_bn254_frs<Builder, T>();
    }
    template <typename T> static inline T convert_from_bn254_frs(std::span<const Fr> frs)
    {
        ASSERT(!frs.empty() && frs[0].get_context() != nullptr);
        Builder* builder = frs[0].get_context();
        return bb::stdlib::field_conversion::convert_from_bn254_frs<Builder, T>(*builder, frs);
    }
    template <typename T> static inline std::vector<Fr> convert_to_bn254_frs(const T& element)
    {
        Builder* builder = element.get_context();
        return bb::stdlib::field_conversion::convert_to_bn254_frs<Builder, T>(*builder, element);
    }
#ifdef DATAFLOW_SANITIZER
    template <typename T> static void dfsan_set_witness_label(const T& val, dfsan_label label)
    {
        if constexpr (IsSimulator<Builder>) {
            return;
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::fr<Builder>>) {
            dfsan_set_label(label, &(val.get_context()->variables[val.get_witness_index()]), sizeof(bb::fr));
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::fq<Builder>>) {
            for (size_t i = 0; i < 4; i++) {
                dfsan_set_label(label,
                                &(val.get_context()->variables[val.binary_basis_limbs[i].element.get_witness_index()]),
                                sizeof(bb::fr));
            }
            dfsan_set_label(
                label, &(val.get_context()->variables[val.prime_basis_limb.get_witness_index()]), sizeof(bb::fr));
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::bn254_element<Builder>>) {
            dfsan_set_witness_label(val.x, label);
            dfsan_set_witness_label(val.y, label);
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::grumpkin_element<Builder>>) {
            dfsan_set_witness_label(val.x, label);
            dfsan_set_witness_label(val.y, label);
        } else {
            // Array or Univariate
            std::vector<bb::stdlib::field_conversion::fr<Builder>> fr_vec;
            for (auto& x : val) {
                dfsan_set_witness_label(x, label);
            }
        }
    }

    template <typename T> static dfsan_label dfsan_get_witness_label(const T& val)
    {
        if constexpr (IsSimulator<Builder>) {
            return 0;
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::fr<Builder>>) {
            return dfsan_read_label(&(val.get_context()->variables[val.get_witness_index()]), sizeof(bb::fr));
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::fq<Builder>>) {
            auto label = dfsan_read_label(val.get_context()->variables[val.prime_basis_limb.get_witness_index()]);
            for (size_t i = 0; i < 4; i++) {
                label = dfsan_union(
                    label,
                    dfsan_read_label(
                        &(val.get_context()->variables[val.binary_basis_limbs[i].element.get_witness_index()]),
                        sizeof(bb::fr)));
            }
            return label;
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::bn254_element<Builder>>) {
            return dfsan_union(dfsan_get_witness_label(val.x), dfsan_get_witness_label(val.y));
        } else if constexpr (IsAnyOf<T, bb::stdlib::field_conversion::grumpkin_element<Builder>>) {
            return dfsan_union(dfsan_get_witness_label(val.x), dfsan_get_witness_label(val.y));
        } else {
            // Array or Univariate
            dfsan_label label = 0;
            for (auto& x : val) {
                label = dfsan_union(
                    label, dfsan_read_label(&(x.get_context()->variables[x.get_witness_index()]), sizeof(bb::fr)));
            }
            return label;
        }
    }
#endif
};

using UltraStdlibTranscript = BaseTranscript<StdlibTranscriptParams<UltraCircuitBuilder>>;
using MegaStdlibTranscript = BaseTranscript<StdlibTranscriptParams<MegaCircuitBuilder>>;
} // namespace bb::stdlib::recursion::honk