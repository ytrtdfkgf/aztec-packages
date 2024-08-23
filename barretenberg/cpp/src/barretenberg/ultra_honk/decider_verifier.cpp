#include "decider_verifier.hpp"
#include "barretenberg/commitment_schemes/gemini/gemini.hpp"
#include "barretenberg/commitment_schemes/shplonk/shplonk.hpp"
#include "barretenberg/numeric/bitop/get_msb.hpp"
#include "barretenberg/sumcheck/instance/verifier_instance.hpp"
#include "barretenberg/transcript/transcript.hpp"

namespace bb {

template <typename Flavor>
DeciderVerifier_<Flavor>::DeciderVerifier_(const std::shared_ptr<VerifierInstance>& accumulator,
                                           const std::shared_ptr<Transcript>& transcript)
    : accumulator(accumulator)
    , pcs_verification_key(accumulator->verification_key->pcs_verification_key)
    , transcript(transcript)
{}

template <typename Flavor>
DeciderVerifier_<Flavor>::DeciderVerifier_(const std::shared_ptr<VerifierInstance>& accumulator)
    : accumulator(accumulator)
    , pcs_verification_key(accumulator->verification_key->pcs_verification_key)
{}

/**
 * @brief This function verifies a decider proof for a given Flavor, produced for a relaxed instance (ϕ, \vec{β*},
 * e*).
 *
 */
template <typename Flavor> bool DeciderVerifier_<Flavor>::verify_proof(const DeciderProof& proof)
{
    transcript = std::make_shared<Transcript>(proof);
    return verify();
}

/**
 * @brief Verify a decider proof that is assumed to be contained in the transcript
 *
 */
template <typename Flavor> bool DeciderVerifier_<Flavor>::verify()
{
    using PCS = typename Flavor::PCS;
    using Curve = typename Flavor::Curve;
    using Shplonk = ShplonkVerifier_<Curve>;
    using Gemini = GeminiVerifier_<Curve>;
    using VerifierCommitments = typename Flavor::VerifierCommitments;
    // using GroupElement = typename Curve::Element;
    // using GroupElement = typename Curve::Element;

    VerifierCommitments commitments{ accumulator->verification_key, accumulator->witness_commitments };
    info("log circuit size", static_cast<size_t>(accumulator->verification_key->log_circuit_size));
    auto log_circuit_size = static_cast<size_t>(accumulator->verification_key->log_circuit_size);

    auto sumcheck = SumcheckVerifier<Flavor>(log_circuit_size, transcript, accumulator->target_sum);

    auto [multivariate_challenge, claimed_evaluations, sumcheck_verified] =
        sumcheck.verify(accumulator->relation_parameters, accumulator->alphas, accumulator->gate_challenges);

    // If Sumcheck did not verify, return false
    if (sumcheck_verified.has_value() && !sumcheck_verified.value()) {
        info("Sumcheck verification failed.");
        return false;
    }

    FF rho = transcript->template get_challenge<FF>("rho");
    multivariate_challenge.resize(log_circuit_size);
    FF gemini_challenge;
    auto gemini_eff_opening_claim =
        Gemini::reduce_efficient_verification(log_circuit_size, gemini_challenge, transcript);
    // batch commitments to prover polynomials and verify gemini claims
    auto shplemini_claim = Shplonk::verify_gemini(Commitment::one(),
                                                  commitments.get_unshifted(),
                                                  commitments.get_to_be_shifted(),
                                                  claimed_evaluations.get_all(),
                                                  multivariate_challenge,
                                                  rho,                      // batching challenge
                                                  gemini_challenge,         // gemini opening
                                                  gemini_eff_opening_claim, // opening claims for the folds
                                                  transcript);
    // Verify the Shplonk claim with KZG or IPA
    auto pairing_points = PCS::reduce_verify(shplemini_claim, transcript);
    auto verified = pcs_verification_key->pairing_check(pairing_points[0], pairing_points[1]);
    return sumcheck_verified.value() && verified;
}

template class DeciderVerifier_<UltraFlavor>;
template class DeciderVerifier_<UltraKeccakFlavor>;
template class DeciderVerifier_<MegaFlavor>;

} // namespace bb
