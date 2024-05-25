// An entrypoint contract that allows everything to go through. Only used for testing
// Pair this with SignerlessWallet to perform multiple actions before any account contracts are deployed (and without authentication)
contract MultiCallEntrypoint {
    use dep::std;

    use dep::aztec::prelude::AztecAddress;
    use dep::authwit::entrypoint::{app::AppPayload, fee::FeePayload};

    #[aztec(private)]
    fn entrypoint(app_payload: AppPayload) {
        app_payload.execute_calls(&mut context);
    }

    #[aztec(private)]
    fn entrypoint_with_fee(app_payload: AppPayload, fee_payload: FeePayload) {
        fee_payload.execute_calls(&mut context);
        context.end_setup();
        app_payload.execute_calls(&mut context);
    }
}
