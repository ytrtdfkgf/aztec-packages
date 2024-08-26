#include "barretenberg/stdlib/honk_verifier/decider_recursive_verifier.hpp"
#include "barretenberg/commitment_schemes/gemini/gemini.hpp"
#include "barretenberg/commitment_schemes/shplonk/shplonk.hpp"
#include "barretenberg/numeric/bitop/get_msb.hpp"
#include "barretenberg/transcript/transcript.hpp"

namespace bb::stdlib::recursion::honk {

/**
 * @brief This function verifies an Ultra Honk proof for a given Flavor, produced for a relaxed instance (ϕ, \vec{β*},
 * e*).
 *
 */
template <typename Flavor>
std::array<typename Flavor::GroupElement, 2> DeciderRecursiveVerifier_<Flavor>::verify_proof(const HonkProof& proof)
{
    using Sumcheck = ::bb::SumcheckVerifier<Flavor>;
    using PCS = typename Flavor::PCS;
    using Curve = typename Flavor::Curve;
    using Shplonk = ShplonkVerifier_<Curve>;
    using Gemini = GeminiVerifier_<Curve>;
    using VerifierCommitments = typename Flavor::VerifierCommitments;
    using Transcript = typename Flavor::Transcript;

    StdlibProof<Builder> stdlib_proof = bb::convert_proof_to_witness(builder, proof);
    transcript = std::make_shared<Transcript>(stdlib_proof);

    VerifierCommitments commitments{ accumulator->verification_key, accumulator->witness_commitments };

    auto sumcheck = Sumcheck(
        static_cast<size_t>(accumulator->verification_key->log_circuit_size), transcript, accumulator->target_sum);

    auto [multivariate_challenge, claimed_evaluations, sumcheck_verified] =
        sumcheck.verify(accumulator->relation_parameters, accumulator->alphas, accumulator->gate_challenges);

    const size_t log_circuit_size =
        numeric::get_msb(static_cast<uint32_t>(accumulator->verification_key->log_circuit_size));
    FF rho = transcript->template get_challenge<FF>("rho");
    multivariate_challenge.resize(log_circuit_size);
    FF gemini_challenge;
    auto gemini_eff_opening_claim =
        Gemini::reduce_efficient_verification(log_circuit_size, gemini_challenge, transcript);
    // batch commitments to prover polynomials and verify gemini claims
    auto shplemini_claim = Shplonk::verify_gemini(Commitment::one(builder),
                                                  commitments.get_unshifted(),
                                                  commitments.get_to_be_shifted(),
                                                  claimed_evaluations.get_all(),
                                                  multivariate_challenge,
                                                  rho,                      // batching challenge
                                                  gemini_challenge,         // gemini opening
                                                                            //   a_0_pos,
                                                  gemini_eff_opening_claim, // opening claims for the folds
                                                  transcript);

    auto pairing_points = PCS::reduce_verify(shplemini_claim, transcript);

    return pairing_points;
}

template class DeciderRecursiveVerifier_<bb::UltraRecursiveFlavor_<UltraCircuitBuilder>>;
template class DeciderRecursiveVerifier_<bb::MegaRecursiveFlavor_<MegaCircuitBuilder>>;
template class DeciderRecursiveVerifier_<bb::UltraRecursiveFlavor_<MegaCircuitBuilder>>;
template class DeciderRecursiveVerifier_<bb::MegaRecursiveFlavor_<UltraCircuitBuilder>>;
template class DeciderRecursiveVerifier_<bb::UltraRecursiveFlavor_<CircuitSimulatorBN254>>;
template class DeciderRecursiveVerifier_<bb::MegaRecursiveFlavor_<CircuitSimulatorBN254>>;
} // namespace bb::stdlib::recursion::honk
