use crate::auth_oracle::AuthWitness;
use dep::aztec::prelude::AztecAddress;
use std::schnorr::verify_signature;

pub fn recover_address(message_hash: Field, witness: AuthWitness) -> AztecAddress {
    let message_bytes: [u8; 32] = message_hash.to_be_bytes();
    // In a single key account contract we re-used ivpk_m as signing key
    let verification = verify_signature(
        witness.keys.ivpk_m.inner.x,
        witness.keys.ivpk_m.inner.y,
        witness.signature,
        message_bytes,
    );
    assert(verification == true);

    AztecAddress::compute(witness.keys, witness.partial_address)
}
