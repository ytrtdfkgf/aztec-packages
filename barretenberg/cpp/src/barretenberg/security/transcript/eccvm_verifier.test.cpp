#include "barretenberg/eccvm/eccvm_verifier.hpp"
#include "barretenberg/eccvm/eccvm_prover.hpp"
#include "barretenberg/eccvm_recursion/eccvm_recursive_verifier.hpp"
#include "barretenberg/ultra_honk/ultra_prover.hpp"
#include "barretenberg/ultra_honk/ultra_verifier.hpp"

#include <gtest/gtest.h>

namespace {
auto& engine = bb::numeric::get_debug_randomness();
}
namespace bb {
template <typename RecursiveFlavor> class ECCVMTranscriptSecurityTest : public ::testing::Test {
  public:
    using InnerFlavor = typename RecursiveFlavor::NativeFlavor;
    using InnerBuilder = typename InnerFlavor::CircuitBuilder;
    using InnerProver = ECCVMProver;
    using InnerVerifier = ECCVMVerifier;
    using InnerG1 = InnerFlavor::Commitment;
    using InnerFF = InnerFlavor::FF;
    using InnerBF = InnerFlavor::BF;

    using Transcript = InnerFlavor::Transcript;

    static void SetUpTestSuite()
    {
        srs::init_grumpkin_crs_factory("../srs_db/grumpkin");
        bb::srs::init_crs_factory("../srs_db/ignition");
    }

    /**
     * @brief Adds operations in BN254 to the op_queue and then constructs and ECCVM circuit from the op_queue.
     *
     * @param engine
     * @return ECCVMCircuitBuilder
     */
    static InnerBuilder generate_circuit(numeric::RNG* engine = nullptr)
    {
        using Curve = curve::BN254;
        using G1 = Curve::Element;
        using Fr = Curve::ScalarField;

        std::shared_ptr<ECCOpQueue> op_queue = std::make_shared<ECCOpQueue>();
        G1 a = G1::random_element(engine);
        G1 b = G1::random_element(engine);
        G1 c = G1::random_element(engine);
        Fr x = Fr::random_element(engine);
        Fr y = Fr::random_element(engine);

        op_queue->add_accumulate(a);
        op_queue->mul_accumulate(a, x);
        op_queue->mul_accumulate(b, x);
        op_queue->mul_accumulate(b, y);
        op_queue->add_accumulate(a);
        op_queue->mul_accumulate(b, x);
        op_queue->eq_and_reset();
        op_queue->add_accumulate(c);
        op_queue->mul_accumulate(a, x);
        op_queue->mul_accumulate(b, x);
        op_queue->eq_and_reset();
        op_queue->mul_accumulate(a, x);
        op_queue->mul_accumulate(b, x);
        op_queue->mul_accumulate(c, x);
        InnerBuilder builder{ op_queue };
        return builder;
    }

    static void test_verification()
    {
        InnerBuilder builder = generate_circuit(&engine);
        InnerProver prover(builder);
        auto proof = prover.construct_proof();
        auto verification_key = std::make_shared<typename InnerFlavor::VerificationKey>(prover.key);

        InnerVerifier verifier{ verification_key };
        size_t maximum_index = 0;
        verifier.verify_proof(proof, &maximum_index, true, 0);
        for (size_t i = 1; i < maximum_index; i++) {
            verifier.verify_proof(proof, nullptr, true, i);
        }
    }
};
using FlavorTypes = testing::Types<ECCVMRecursiveFlavor_<UltraCircuitBuilder>>;

TYPED_TEST_SUITE(ECCVMTranscriptSecurityTest, FlavorTypes);

TYPED_TEST(ECCVMTranscriptSecurityTest, SingleVerification)
{
    TestFixture::test_verification();
};

} // namespace bb