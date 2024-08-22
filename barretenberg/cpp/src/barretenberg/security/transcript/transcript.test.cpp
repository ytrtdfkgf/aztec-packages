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
    NativeTranscript prover_transcript;
    prover_transcript.send_to_verifier("A", Fr::random_element());
    prover_transcript.get_challenge<Fr>("challenge_0");
    prover_transcript.send_to_verifier("B", Fr::random_element());
    prover_transcript.get_challenge<Fr>("challenge_1");

    HonkProof native_proof = prover_transcript.export_proof();
    NativeTranscript verifier_transcript(native_proof, /*enable_sanitizer=*/true, /*separation_index=*/0);
    auto a = verifier_transcript.receive_from_prover<Fr>("A");
    auto challenge_0 = verifier_transcript.get_challenge<Fr>("challenge_0");
    auto b = verifier_transcript.receive_from_prover<Fr>("B");
    auto challenge_1 = verifier_transcript.get_challenge<Fr>("challenge_1");
    auto get_witness_label = [](auto& val) { return static_cast<uint32_t>(dfsan_read_label(&val, sizeof(val))); };
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
    ASSERT_DEATH(
        {
            auto x = b * challenge_0;
            info(x);
        },
        ".*Dangerous transcript "
        "interaction detected.*");
}
