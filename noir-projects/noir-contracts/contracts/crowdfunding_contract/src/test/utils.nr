use dep::aztec::{
    hash::compute_secret_hash, prelude::AztecAddress,
    test::helpers::{cheatcodes, test_environment::TestEnvironment},
    protocol_types::storage::map::derive_storage_slot_in_map,
    oracle::{execution::{get_block_number, get_contract_address}, unsafe_rand::unsafe_rand, storage::storage_read}
};

use crate::Crowdfunding;
use dep::token::Token;

pub fn setup(with_account_contracts: bool) -> (&mut TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    // Setup env, generate keys
    let mut env = TestEnvironment::new();
    let (owner, recipient) = if with_account_contracts {
        let owner = env.create_account_contract(1);
        let recipient = env.create_account_contract(2);
        // Deploy canonical auth registry
        let _auth_registry = env.deploy("./@auth_registry_contract", "AuthRegistry").without_initializer();
        (owner, recipient)
    } else {
        let owner = env.create_account();
        let recipient = env.create_account();
        (owner, recipient)
    };

    // Start the test in the account contract address
    env.impersonate(owner);
    // Deploy donation token contract
    let donation_initializer_call_interface = Token::interface().constructor(
        owner,
        "DonationToken",
        "DNT",
        18
    );
    let donation_token_contract = env.deploy_self("Token").with_public_initializer(donation_initializer_call_interface);
    let donation_token_contract_address = donation_token_contract.to_address();

    // deploy rewared token contract
    let reward_initializer_call_interface = Token::interface().constructor(
        owner,
        "DonationToken",
        "DNT",
        18
    );
    let reward_token_contract = env.deploy_self("Token").with_public_initializer(reward_initializer_call_interface);
    let reward_token_contract_address = reward_token_contract.to_address();

    let deadline = 100 as u64; // double check what this value shoue be

    let crowdfunding_initializer_call_interface = Crowdfunding::interface().init(donation_token_contract_address, owner, deadline);
    let crowdfunding_contract = env.deploy_self("Counter").with_public_initializer(crowdfunding_initializer_call_interface);
    let crowdfunding_contract_address = counter_contract.to_address();
    env.advance_block_by(1);
    (&mut env, crowdfunding_contract_address, owner, recipient)
}
