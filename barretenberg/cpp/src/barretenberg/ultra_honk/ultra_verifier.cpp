#include "./ultra_verifier.hpp"
#include "barretenberg/commitment_schemes/gemini/gemini.hpp"
#include "barretenberg/commitment_schemes/shplonk/shplonk.hpp"
#include "barretenberg/commitment_schemes/zeromorph/zeromorph.hpp"
#include "barretenberg/numeric/bitop/get_msb.hpp"
#include "barretenberg/transcript/transcript.hpp"
#include "barretenberg/ultra_honk/oink_verifier.hpp"

namespace bb {
template <typename Flavor>
UltraVerifier_<Flavor>::UltraVerifier_(const std::shared_ptr<Transcript>& transcript,
                                       const std::shared_ptr<VerificationKey>& verifier_key)
    : key(verifier_key)
    , transcript(transcript)
{}

/**
 * @brief Construct an UltraVerifier directly from a verification key
 *
 * @tparam Flavor
 * @param verifier_key
 */
template <typename Flavor>
UltraVerifier_<Flavor>::UltraVerifier_(const std::shared_ptr<VerificationKey>& verifier_key)
    : key(verifier_key)
    , transcript(std::make_shared<Transcript>())
{}

template <typename Flavor>
UltraVerifier_<Flavor>::UltraVerifier_(UltraVerifier_&& other)
    : key(std::move(other.key))
{}

template <typename Flavor> UltraVerifier_<Flavor>& UltraVerifier_<Flavor>::operator=(UltraVerifier_&& other)
{
    key = other.key;
    return *this;
}

/**
 * @brief This function verifies an Ultra Honk proof for a given Flavor.
 *
 */
template <typename Flavor> bool UltraVerifier_<Flavor>::verify_proof(const HonkProof& proof)
{
    using FF = typename Flavor::FF;
    using PCS = typename Flavor::PCS;
    using Curve = typename Flavor::Curve;
    // using ZeroMorph = ZeroMorphVerifier_<Curve>;
    using Shplonk = ShplonkVerifier_<Curve>;
    using Gemini = GeminiVerifier_<Curve>;
    using VerifierCommitments = typename Flavor::VerifierCommitments;
    using GroupElement = typename Curve::Element;

    transcript = std::make_shared<Transcript>(proof);
    VerifierCommitments commitments{ key };
    OinkVerifier<Flavor> oink_verifier{ key, transcript };
    auto [relation_parameters, witness_commitments, public_inputs, alphas] = oink_verifier.verify();

    // Copy the witness_commitments over to the VerifierCommitments
    for (auto [wit_comm_1, wit_comm_2] : zip_view(commitments.get_witness(), witness_commitments.get_all())) {
        wit_comm_1 = wit_comm_2;
    }

    // Execute Sumcheck Verifier
    const size_t log_circuit_size = static_cast<size_t>(numeric::get_msb(key->circuit_size));
    auto sumcheck = SumcheckVerifier<Flavor>(log_circuit_size, transcript);

    auto gate_challenges = std::vector<FF>(log_circuit_size);
    for (size_t idx = 0; idx < log_circuit_size; idx++) {
        gate_challenges[idx] = transcript->template get_challenge<FF>("Sumcheck:gate_challenge_" + std::to_string(idx));
    }
    auto [multivariate_challenge, claimed_evaluations, sumcheck_verified] =
        sumcheck.verify(relation_parameters, alphas, gate_challenges);

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
        key->pcs_verification_key->pairing_check(shplonk_pairing_points[0], shplonk_pairing_points[1]);
    info(pcs_shplonk_verified);
    return sumcheck_verified.value() && pcs_shplonk_verified;
}

template class UltraVerifier_<UltraFlavor>;
template class UltraVerifier_<UltraKeccakFlavor>;
template class UltraVerifier_<MegaFlavor>;

} // namespace bb
