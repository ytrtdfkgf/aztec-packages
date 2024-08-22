#include "decider_verifier.hpp"
// #include "barretenberg/commitment_schemes/zeromorph/zeromorph.hpp"
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
    using GroupElement = typename Curve::Element;
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
    // Construct inputs for Gemini verifier:
    // - Multivariate opening point u = (u_0, ..., u_{d-1})
    // - batched unshifted and to-be-shifted polynomial commitments
    auto batched_commitment_unshifted = GroupElement::zero();
    auto batched_commitment_to_be_shifted = GroupElement::zero();

    // Compute powers of batching challenge rho
    FF rho = transcript->template get_challenge<FF>("rho");
    std::vector<FF> rhos = gemini::powers_of_rho(rho, Flavor::NUM_ALL_ENTITIES);

    // Compute batched multivariate evaluation
    FF batched_evaluation = FF::zero();
    size_t evaluation_idx = 0;
    for (auto& value : claimed_evaluations.get_all()) {
        batched_evaluation += value * rhos[evaluation_idx];
        ++evaluation_idx;
    }

    // Construct batched commitment for NON-shifted polynomials
    size_t commitment_idx = 0;
    for (auto& commitment : commitments.get_unshifted()) {
        batched_commitment_unshifted = batched_commitment_unshifted + commitment * rhos[commitment_idx];
        ++commitment_idx;
    }

    // Construct batched commitment for to-be-shifted polynomials
    for (auto& commitment : commitments.get_to_be_shifted()) {
        batched_commitment_to_be_shifted = batched_commitment_to_be_shifted + commitment * rhos[commitment_idx];
        ++commitment_idx;
    }
    multivariate_challenge.resize(log_circuit_size);
    auto gemini_opening_claim = Gemini::reduce_verification(multivariate_challenge,
                                                            /*define!*/ batched_evaluation,
                                                            /*define*/ batched_commitment_unshifted,
                                                            /*define*/ batched_commitment_to_be_shifted,
                                                            transcript);

    auto shplonk_key = Commitment::one();
    // Produce a Shplonk claim: commitment [Q] - [Q_z], evaluation zero (at random challenge z)
    auto shplonk_claim = Shplonk::reduce_verification(shplonk_key, gemini_opening_claim, transcript);

    // // Verify the Shplonk claim with KZG or IPA
    auto shplonk_pairing_points = PCS::reduce_verify(shplonk_claim, transcript);
    auto pcs_shplonk_verified =
        pcs_verification_key->pairing_check(shplonk_pairing_points[0], shplonk_pairing_points[1]);
    info(pcs_shplonk_verified);
    return sumcheck_verified.value() && pcs_shplonk_verified;
}

template class DeciderVerifier_<UltraFlavor>;
template class DeciderVerifier_<UltraKeccakFlavor>;
template class DeciderVerifier_<MegaFlavor>;

} // namespace bb
