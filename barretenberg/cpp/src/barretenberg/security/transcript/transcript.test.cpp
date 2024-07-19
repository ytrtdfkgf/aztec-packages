#include "barretenberg/stdlib/honk_recursion/transcript/transcript.hpp"
#include "barretenberg/stdlib/primitives/field/field.hpp"
#include <gtest/gtest.h>

#include <sanitizer/dfsan_interface.h>
using namespace bb;

using FF = bb::fr;
using Fr = bb::fr;
using Fq = bb::fq;
using Transcript = NativeTranscript;

/**
 * @brief Test DFSAN
 *
 */
TEST(TranscriptSecurity, EnsureDFSanWorks)
{
    int i = 100;
    int j = 200;
    dfsan_label i_label = 1;
    dfsan_label j_label = 2;
    dfsan_set_label(i_label, &i, sizeof(i));
    dfsan_set_label(j_label, &j, sizeof(j));

    EXPECT_EQ(static_cast<uint32_t>(dfsan_get_label(i + j)), 3);
}

TEST(TranscriptSecurity, BasicInteraction)
{
    using fr_ct = bb::stdlib::field_t<UltraCircuitBuilder>;
    NativeTranscript prover_transcript;
    prover_transcript.send_to_verifier("A", Fr::random_element());
    prover_transcript.get_challenge<Fr>("challenge_0");
    prover_transcript.send_to_verifier("B", Fr::random_element());
    prover_transcript.get_challenge<Fr>("challenge_1");

    HonkProof native_proof = prover_transcript.export_proof();
    auto builder = UltraCircuitBuilder();
    auto stdlib_proof = bb::convert_proof_to_witness(&builder, native_proof);
    stdlib::recursion::honk::UltraStdlibTranscript verifier_transcript(stdlib_proof, 0);
    auto a = verifier_transcript.receive_from_prover<fr_ct>("A");
    auto challenge_0 = verifier_transcript.get_challenge<fr_ct>("challenge_0");
    auto b = verifier_transcript.receive_from_prover<fr_ct>("B");
    auto challenge_1 = verifier_transcript.get_challenge<fr_ct>("challenge_1");
    auto get_witness_label = [](auto& val) {
        return static_cast<uint32_t>(
            bb::stdlib::recursion::honk::StdlibTranscriptParams<UltraCircuitBuilder>::dfsan_get_witness_label(val));
    };
    info("a: ", get_witness_label(a));
    info("b: ", get_witness_label(b));
    info("challenge_0:", get_witness_label(challenge_0));
    info("challenge_1:", get_witness_label(challenge_1));
    EXPECT_NO_THROW(a * challenge_0);
    auto a0 = a * challenge_0;
    EXPECT_EQ(get_witness_label(a) | get_witness_label(challenge_0), get_witness_label(a0));
    EXPECT_NO_THROW(a * challenge_1);
    auto a1 = a * challenge_1;
    EXPECT_EQ(get_witness_label(a) | get_witness_label(challenge_1), get_witness_label(a1));
    EXPECT_NO_THROW(b * challenge_1);
    auto b1 = b * challenge_1;
    EXPECT_EQ(get_witness_label(b) | get_witness_label(challenge_1), get_witness_label(b1));
    EXPECT_ANY_THROW(b * challenge_0);
}
