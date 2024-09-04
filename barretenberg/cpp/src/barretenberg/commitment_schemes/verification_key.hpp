#pragma once

/**
 * @brief Provides interfaces for different PCS 'VerificationKey' classes.
 *
 */

#include "barretenberg/commitment_schemes/commitment_key.hpp"
#include "barretenberg/ecc/curves/bn254/bn254.hpp"
#include "barretenberg/ecc/curves/bn254/pairing.hpp"
#include "barretenberg/ecc/curves/grumpkin/grumpkin.hpp"
#include "barretenberg/ecc/scalar_multiplication/scalar_multiplication.hpp"
#include "barretenberg/numeric/bitop/pow.hpp"
#include "barretenberg/polynomials/polynomial_arithmetic.hpp"
#include "barretenberg/srs/global_crs.hpp"

#include <cstddef>
#include <memory>
#include <string_view>

namespace bb {

template <class Curve> class VerifierCommitmentKey;

/**
 * @brief Specialization for bn254
 *
 * @tparam curve::BN254
 */
template <> class VerifierCommitmentKey<curve::BN254> {
  public:
    using Curve = curve::BN254;
    using GroupElement = typename Curve::Element;
    using Commitment = typename Curve::AffineElement;

    VerifierCommitmentKey()
    {
        srs = srs::get_crs_factory<Curve>()->get_verifier_crs();
    };

    Commitment get_g1_identity() { return srs->get_g1_identity(); }

    /**
     * @brief verifies a pairing equation over 2 points using the verifier SRS
     *
     * @param p0 = P₀
     * @param p1 = P₁
     * @return e(P₀,[1]₁)e(P₁,[x]₂) ≡ [1]ₜ
     */
    bool pairing_check(const GroupElement& p0, const GroupElement& p1)
    {
        Commitment pairing_points[2]{ p0, p1 };
        // The final pairing check of step 12.
        Curve::TargetField result =
            bb::pairing::reduced_ate_pairing_batch_precomputed(pairing_points, srs->get_precomputed_g2_lines(), 2);

        return (result == Curve::TargetField::one());
    }

  private:
    std::shared_ptr<bb::srs::factories::VerifierCrs<Curve>> srs;
};

/**
 * @brief Specialization for Grumpkin
 *
 * @tparam curve::Grumpkin
 */
template <> class VerifierCommitmentKey<curve::Grumpkin> {
  public:
    using Curve = curve::Grumpkin;
    using GroupElement = typename Curve::Element;
    using Commitment = typename Curve::AffineElement;

    /**
     * @brief Construct a new IPA Verification Key object from an SRS strategy (factory)
     */
    VerifierCommitmentKey(const std::shared_ptr<bb::srs::factories::CrsFactory<curve::Grumpkin>>& crs_factory) : crs_factory(crs_factory)
    {}
    // Use the default SRS strategy (factory)
    VerifierCommitmentKey() : VerifierCommitmentKey(srs::get_grumpkin_crs_factory()) {}

    Commitment get_g1_identity() { return crs_factory->get_verifier_crs()->get_g1_identity(); }

    std::span<const Commitment> get_monomial_points(size_t num_required)
    {
        std::span<const Commitment> points = crs_factory->get_verifier_crs(num_required)->get_monomial_points();
        ASSERT(points.size() >= num_required);
        return points;
    }

    scalar_multiplication::pippenger_runtime_state<Curve>& get_pippenger_runtime_state(size_t num_required)
    {
        // Require an exact pippenger_runtime_state
        if (pippenger_runtime_state.num_points != num_required * 2) {
            pippenger_runtime_state = scalar_multiplication::pippenger_runtime_state<Curve>{num_required};
        }
        return pippenger_runtime_state;
    }

  private:
    scalar_multiplication::pippenger_runtime_state<Curve> pippenger_runtime_state{0};
    std::shared_ptr<bb::srs::factories::CrsFactory<curve::Grumpkin>> crs_factory;
};

} // namespace bb
