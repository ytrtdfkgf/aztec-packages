#include "decider_prover.hpp"
#include "barretenberg/common/op_count.hpp"
#include "barretenberg/sumcheck/sumcheck.hpp"

namespace bb {

/**
 * Create DeciderProver_ from an accumulator.
 *
 * @param accumulator Relaxed instance (ϕ, ω, \vec{β}, e) whose proof we want to generate, produced by Protogalaxy
 * folding prover
 *
 * @tparam a type of UltraFlavor
 * */
template <IsUltraFlavor Flavor>
DeciderProver_<Flavor>::DeciderProver_(const std::shared_ptr<Instance>& inst,
                                       const std::shared_ptr<Transcript>& transcript)
    : accumulator(std::move(inst))
    , transcript(transcript)
    , commitment_key(accumulator->proving_key.commitment_key)
{}

/**
 * @brief Run Sumcheck to establish that ∑_i pow(\vec{β*})f_i(ω) = e*. This results in u = (u_1,...,u_d) sumcheck round
 * challenges and all evaluations at u being calculated.
 *
 */
template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_relation_check_rounds()
{
    using Sumcheck = SumcheckProver<Flavor>;
    auto instance_size = accumulator->proving_key.circuit_size;
    auto sumcheck = Sumcheck(instance_size, transcript);
    sumcheck_output = sumcheck.prove(accumulator);
}

// /**
//  * @brief Execute the ZeroMorph protocol to produce an opening claim for the multilinear evaluations produced by
//  * Sumcheck and then produce an opening proof with a univariate PCS.
//  * @details See https://hackmd.io/dlf9xEwhTQyE3hiGbq4FsA?view for a complete description of the unrolled protocol.
//  *
//  * */
// template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_pcs_rounds()
// {
//     using ZeroMorph = ZeroMorphProver_<Curve>;

//     auto prover_opening_claim = ZeroMorph::prove(accumulator->proving_key.circuit_size,
//                                                  accumulator->proving_key.polynomials.get_unshifted(),
//                                                  accumulator->proving_key.polynomials.get_to_be_shifted(),
//                                                  sumcheck_output.claimed_evaluations.get_unshifted(),
//                                                  sumcheck_output.claimed_evaluations.get_shifted(),
//                                                  sumcheck_output.challenge,
//                                                  commitment_key,
//                                                  transcript);
//     PCS::compute_opening_proof(commitment_key, prover_opening_claim, transcript);
// }

/**
 * - Get rho challenge
 * - Compute d+1 Fold polynomials and their evaluations.
 *
 * */
template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_univariatization_round()
{
    const size_t NUM_POLYNOMIALS = Flavor::NUM_ALL_ENTITIES;
    using Gemini = GeminiProver_<Curve>;
    // Generate batching challenge ρ and powers 1,ρ,…,ρᵐ⁻¹
    FF rho = transcript->template get_challenge<FF>("rho");
    std::vector<FF> rhos = gemini::powers_of_rho(rho, NUM_POLYNOMIALS);
    size_t circuit_size = accumulator->proving_key.circuit_size;
    auto sumcheck_challenges = sumcheck_output.challenge;
    size_t log_circuit_size = accumulator->proving_key.log_circuit_size;
    sumcheck_challenges.resize(log_circuit_size);
    // Batch the unshifted polynomials and the to-be-shifted polynomials using ρ
    Polynomial batched_poly_unshifted(circuit_size); // batched unshifted polynomials
    size_t poly_idx = 0;                             // TODO(#391) zip
    for (auto& unshifted_poly : accumulator->proving_key.polynomials.get_unshifted()) {
        batched_poly_unshifted.add_scaled(unshifted_poly, rhos[poly_idx]);
        ++poly_idx;
    }

    Polynomial batched_poly_to_be_shifted(circuit_size); // batched to-be-shifted polynomials
    for (auto& to_be_shifted_poly : accumulator->proving_key.polynomials.get_to_be_shifted()) {
        batched_poly_to_be_shifted.add_scaled(to_be_shifted_poly, rhos[poly_idx]);
        ++poly_idx;
    };

    // Compute d-1 polynomials Fold^(i), i = 1, ..., d-1.
    fold_polynomials = Gemini::compute_gemini_polynomials(
        sumcheck_challenges, std::move(batched_poly_unshifted), std::move(batched_poly_to_be_shifted));
    // Comute and add to trasnscript the commitments [Fold^(i)], i = 1, ..., d-1
    for (size_t l = 0; l < accumulator->proving_key.log_circuit_size - 1; ++l) {
        Commitment current_commitment = commitment_key->commit(fold_polynomials[l + 2]);
        transcript->send_to_verifier("Gemini:FOLD_" + std::to_string(l + 1), current_commitment);
    }
}

/**
 * - Do Fiat-Shamir to get "r" challenge
 * - Compute remaining two partially evaluated Fold polynomials Fold_{r}^(0) and Fold_{-r}^(0).
 * - Compute and aggregate opening pairs (challenge, evaluation) for each of d Fold polynomials.
 * - Add d-many Fold evaluations a_i, i = 0, ..., d-1 to the transcript, excluding eval of Fold_{r}^(0)
 * */
template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_pcs_evaluation_round()
{
    const FF r_challenge = transcript->template get_challenge<FF>("Gemini:r");
    auto sumcheck_challenges = sumcheck_output.challenge;
    size_t log_circuit_size = accumulator->proving_key.log_circuit_size;
    sumcheck_challenges.resize(log_circuit_size);
    gemini_output =
        Gemini::compute_fold_polynomial_evaluations(sumcheck_challenges, std ::move(fold_polynomials), r_challenge);

    for (size_t l = 0; l < accumulator->proving_key.log_circuit_size; ++l) {
        std::string label = "Gemini:a_" + std::to_string(l);
        const auto& evaluation = gemini_output[l + 1].opening_pair.evaluation;
        transcript->send_to_verifier(label, evaluation);
    }
}

/**
 * - Do Fiat-Shamir to get "z" challenge.
 * - Compute polynomial Q(X) - Q_z(X)
 * */
template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_shplonk_partial_evaluation_round()
{
    nu_challenge = transcript->template get_challenge<FF>("Shplonk:nu");

    batched_quotient_Q = Shplonk::compute_batched_quotient(gemini_output, nu_challenge);

    Commitment batched_commitment_Q = commitment_key->commit(batched_quotient_Q);
    // commit to Q(X) and add [Q] to the transcript
    transcript->send_to_verifier("Shplonk:Q", batched_commitment_Q);
    const FF z_challenge = transcript->template get_challenge<FF>("Shplonk:z");

    shplonk_output = Shplonk::compute_partially_evaluated_batched_quotient(
        gemini_output, batched_quotient_Q, nu_challenge, z_challenge);
}
/**
 * - Compute final PCS opening proof:
 * - For KZG, this is the quotient commitment [W]_1
 * - For IPA, the vectors L and R
 * */
template <IsUltraFlavor Flavor> void DeciderProver_<Flavor>::execute_final_pcs_round()
{
    PCS::compute_opening_proof(commitment_key, shplonk_output, transcript);
    // queue.add_commitment(quotient_W, "KZG:W");
}

template <IsUltraFlavor Flavor> HonkProof DeciderProver_<Flavor>::export_proof()
{
    proof = transcript->proof_data;
    return proof;
}

template <IsUltraFlavor Flavor> HonkProof DeciderProver_<Flavor>::construct_proof()
{
    BB_OP_COUNT_TIME_NAME("Decider::construct_proof");

    // Run sumcheck subprotocol.
    execute_relation_check_rounds();
    execute_univariatization_round();
    execute_pcs_evaluation_round();
    execute_shplonk_partial_evaluation_round();
    execute_final_pcs_round();
    return export_proof();
}

template class DeciderProver_<UltraFlavor>;
template class DeciderProver_<UltraKeccakFlavor>;
template class DeciderProver_<MegaFlavor>;

} // namespace bb
