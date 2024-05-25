import { SchnorrAccountContract, getSchnorrAccount } from '@aztec/accounts/schnorr';
import {
  AccountManager,
  type AccountWallet,
  type DebugLogger,
  Fr,
  NativeFeePaymentMethod,
  NativeFeePaymentMethodWithClaim,
  type PXE,
  PrivateFeePaymentMethod,
  PublicFeePaymentMethod,
  Schnorr,
  SignerlessWallet,
  type Wallet,
  computeSecretHash,
  deriveKeys,
} from '@aztec/aztec.js';
import { type EntrypointInterface, EntrypointPayload, type ExecutionRequestInit } from '@aztec/aztec.js/entrypoint';
// eslint-disable-next-line no-restricted-imports
import { FunctionCall, PackedValues, TxExecutionRequest } from '@aztec/circuit-types';
import { type AztecAddress, GasSettings, GeneratorIndex, TxContext } from '@aztec/circuits.js';
import { type CompleteAddress, Fq } from '@aztec/circuits.js';
import { type FunctionAbi, FunctionSelector, FunctionType, encodeArguments } from '@aztec/foundation/abi';
import { padArrayEnd } from '@aztec/foundation/collection';
import {
  type TokenContract as BananaCoin,
  SchnorrAccountContract as BobsAccountContract,
  type FPCContract,
} from '@aztec/noir-contracts.js';
import { GasTokenAddress } from '@aztec/protocol-contracts/gas-token';

import { jest } from '@jest/globals';

import { FeesTest } from './fees_test.js';

jest.setTimeout(300_000);

describe('e2e_fees account_init', () => {
  const t = new FeesTest('account_init');

  beforeAll(async () => {
    await t.applyBaseSnapshots();
    await t.applyFundAliceWithBananas();
    await t.applyFPCSetupSnapshot();
    ({ aliceAddress, aliceWallet, bananaCoin, bananaFPC, pxe, logger } = await t.setup());
  });

  afterAll(async () => {
    await t.teardown();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let logger: DebugLogger;
  let pxe: PXE;
  let gasSettings: GasSettings;
  let maxFee: bigint;
  let bananaCoin: BananaCoin;
  let bananaFPC: FPCContract;

  // Alice pays for deployments when we need someone else to intervene
  let aliceWallet: Wallet;
  let aliceAddress: AztecAddress;

  // Bob is the account being created (a fresh account is generated for each test)
  let bobsSecretKey: Fr;
  let bobsPrivateSigningKey: Fq;
  let bobsAccountManager: AccountManager;
  let bobsCompleteAddress: CompleteAddress;
  let bobsAddress: AztecAddress;
  let bobsWallet: AccountWallet;

  // Seeded by initBalances below in a beforeEach hook
  let fpcsInitialGas: bigint;
  let fpcsInitialPublicBananas: bigint;

  async function initBalances() {
    [[fpcsInitialGas], [fpcsInitialPublicBananas]] = await Promise.all([
      t.gasBalances(bananaFPC.address),
      t.bananaPublicBalances(bananaFPC.address),
    ]);
  }

  beforeEach(async () => {
    bobsSecretKey = Fr.random();
    bobsPrivateSigningKey = Fq.random();
    bobsAccountManager = getSchnorrAccount(pxe, bobsSecretKey, bobsPrivateSigningKey, Fr.random());
    bobsCompleteAddress = bobsAccountManager.getCompleteAddress();
    bobsAddress = bobsCompleteAddress.address;
    bobsWallet = await bobsAccountManager.getWallet();

    gasSettings = t.gasSettings;
    maxFee = gasSettings.getFeeLimit().toBigInt();

    await bobsAccountManager.register();
    await initBalances();
  });

  describe('account pays its own fee', () => {
    it('pays natively in the gas token after Alice bridges funds', async () => {
      await t.gasTokenContract.methods.mint_public(bobsAddress, t.INITIAL_GAS_BALANCE).send().wait();
      const [bobsInitialGas] = await t.gasBalances(bobsAddress);
      expect(bobsInitialGas).toEqual(t.INITIAL_GAS_BALANCE);

      const paymentMethod = new NativeFeePaymentMethod(bobsAddress);
      const tx = await bobsAccountManager.deploy({ fee: { gasSettings, paymentMethod } }).wait();

      expect(tx.transactionFee!).toBeGreaterThan(0n);
      await expect(t.gasBalances(bobsAddress)).resolves.toEqual([bobsInitialGas - tx.transactionFee!]);
    });

    it.skip('pays natively in the gas token by bridging funds themselves (with NativeFeePaymentMethodWithClaim)', async () => {
      // This test is skipped because the NativeFeePaymentMethodWithClaim does not work when
      // deploying an account. This method requires enqueueing a public function call for setup
      // that claims the balance bridged, but since account deployment starts with a multicall
      // entrypoint (as opposed to the account contract entrypoint), and only the first function
      // in the call stack can enqueue a setup public function call, the claim is processed as
      // in the application phase. We work around this in the test below.
      const { secret } = await t.gasBridgeTestHarness.prepareTokensOnL1(
        t.INITIAL_GAS_BALANCE,
        t.INITIAL_GAS_BALANCE,
        bobsAddress,
      );

      const paymentMethod = new NativeFeePaymentMethodWithClaim(bobsAddress, t.INITIAL_GAS_BALANCE, secret);
      const tx = await bobsAccountManager.deploy({ fee: { gasSettings, paymentMethod } }).wait();
      expect(tx.transactionFee!).toBeGreaterThan(0n);
      await expect(t.gasBalances(bobsAddress)).resolves.toEqual([t.INITIAL_GAS_BALANCE - tx.transactionFee!]);
    });

    it('pays natively in the gas token by bridging funds themselves (with workaround)', async () => {
      // As a workaround for the test above, we use the vanilla native fee payment method, but prepend
      // a call to
      const { secret: claimSecret } = await t.gasBridgeTestHarness.prepareTokensOnL1(
        t.INITIAL_GAS_BALANCE,
        t.INITIAL_GAS_BALANCE,
        bobsAddress,
      );

      const { chainId, protocolVersion } = await pxe.getNodeInfo();
      const entrypoint = new WorkaroundMulticallEntrypointWithClaimAsFee(
        bobsAddress,
        chainId,
        protocolVersion,
        t.INITIAL_GAS_BALANCE,
        claimSecret,
      );
      const deployWallet = new SignerlessWallet(pxe, entrypoint);

      bobsAccountManager = new (class extends AccountManager {
        protected override getDeployWallet(): Promise<SignerlessWallet> {
          return Promise.resolve(deployWallet);
        }
      })(pxe, bobsSecretKey, new SchnorrAccountContract(bobsPrivateSigningKey), bobsAccountManager.salt);

      const paymentMethod = new NativeFeePaymentMethod(bobsAddress);
      const tx = await bobsAccountManager.deploy({ fee: { gasSettings, paymentMethod } }).wait();

      // HACK: We can modify the deployRequest because the deployMethod caches a reference to it,
      // so when we then send it, it will send the modified reference. This is horrible and we
      // need a better API for this.
      // const tx = await deployMethod
      //   .send({
      //     contractAddressSalt: bobsAccountManager.salt,
      //     skipClassRegistration: true,
      //     skipPublicDeployment: true,
      //     skipInitialization: false,
      //     universalDeploy: true,
      //     fee: { gasSettings, paymentMethod },
      //   })
      //   .wait();

      // Check fee payment
      expect(tx.transactionFee!).toBeGreaterThan(0n);
      await expect(t.gasBalances(bobsAddress)).resolves.toEqual([t.INITIAL_GAS_BALANCE - tx.transactionFee!]);

      // Check that Bob can now use his wallet for sending txs
      await bananaCoin.withWallet(bobsWallet).methods.transfer_public(bobsAddress, aliceAddress, 0n, 0n).send().wait();
    });

    it('pays privately through an FPC', async () => {
      // Alice mints bananas to Bob
      const mintedBananas = BigInt(1e12);
      await t.mintPrivateBananas(mintedBananas, bobsAddress);

      // Bob deploys his account through the private FPC
      const rebateSecret = Fr.random();
      const paymentMethod = new PrivateFeePaymentMethod(
        bananaCoin.address,
        bananaFPC.address,
        await bobsAccountManager.getWallet(),
        rebateSecret,
      );

      const tx = await bobsAccountManager.deploy({ fee: { gasSettings, paymentMethod } }).wait();
      const actualFee = tx.transactionFee!;
      expect(actualFee).toBeGreaterThan(0n);

      // the new account should have paid the full fee to the FPC
      await expect(t.bananaPrivateBalances(bobsAddress)).resolves.toEqual([mintedBananas - maxFee]);

      // the FPC got paid through "unshield", so it's got a new public balance
      await expect(t.bananaPublicBalances(bananaFPC.address)).resolves.toEqual([fpcsInitialPublicBananas + actualFee]);

      // the FPC should have been the fee payer
      await expect(t.gasBalances(bananaFPC.address)).resolves.toEqual([fpcsInitialGas - actualFee]);

      // the new account should have received a refund
      await t.addPendingShieldNoteToPXE(bobsAddress, maxFee - actualFee, computeSecretHash(rebateSecret), tx.txHash);

      // and it can redeem the refund
      await bananaCoin.methods
        .redeem_shield(bobsAddress, maxFee - actualFee, rebateSecret)
        .send()
        .wait();

      await expect(t.bananaPrivateBalances(bobsAddress)).resolves.toEqual([mintedBananas - actualFee]);
    });

    it('pays publicly through an FPC', async () => {
      const mintedBananas = BigInt(1e12);
      await bananaCoin.methods.mint_public(bobsAddress, mintedBananas).send().wait();

      const paymentMethod = new PublicFeePaymentMethod(bananaCoin.address, bananaFPC.address, bobsWallet);
      const tx = await bobsAccountManager
        .deploy({
          skipPublicDeployment: false,
          fee: { gasSettings, paymentMethod },
        })
        .wait();

      const actualFee = tx.transactionFee!;
      expect(actualFee).toBeGreaterThan(0n);

      // we should have paid the fee to the FPC
      await expect(t.bananaPublicBalances(bobsAddress, bananaFPC.address)).resolves.toEqual([
        mintedBananas - actualFee,
        fpcsInitialPublicBananas + actualFee,
      ]);

      // the FPC should have paid the sequencer
      await expect(t.gasBalances(bananaFPC.address)).resolves.toEqual([fpcsInitialGas - actualFee]);
    });
  });

  describe('another account pays the fee', () => {
    it('pays natively in the gas token', async () => {
      // mint gas tokens to alice
      await t.gasTokenContract.methods.mint_public(aliceAddress, t.INITIAL_GAS_BALANCE).send().wait();
      const [alicesInitialGas] = await t.gasBalances(aliceAddress);

      // bob generates the private keys for his account on his own
      const bobsPublicKeysHash = deriveKeys(bobsSecretKey).publicKeys.hash();
      const bobsSigningPubKey = new Schnorr().computePublicKey(bobsPrivateSigningKey);
      const bobsInstance = bobsAccountManager.getInstance();

      // alice registers bobs keys in the pxe
      await pxe.registerRecipient(bobsCompleteAddress);

      // and deploys bob's account, paying the fee from her balance
      const paymentMethod = new NativeFeePaymentMethod(aliceAddress);
      const tx = await BobsAccountContract.deployWithPublicKeysHash(
        bobsPublicKeysHash,
        aliceWallet,
        bobsSigningPubKey.x,
        bobsSigningPubKey.y,
      )
        .send({
          contractAddressSalt: bobsInstance.salt,
          skipClassRegistration: true,
          skipPublicDeployment: true,
          skipInitialization: false,
          universalDeploy: true,
          fee: { gasSettings, paymentMethod },
        })
        .wait();

      // alice paid in gas tokens
      expect(tx.transactionFee!).toBeGreaterThan(0n);
      await expect(t.gasBalances(aliceAddress)).resolves.toEqual([alicesInitialGas - tx.transactionFee!]);

      // bob can now use his wallet for sending txs
      await bananaCoin.withWallet(bobsWallet).methods.transfer_public(bobsAddress, aliceAddress, 0n, 0n).send().wait();
    });
  });
});

// HACKs below this line to make the claim-and-pay-fee-natively flow work with the current circuits.
// We should be able to remove this once we can enqueue public setup calls outside the first function call.
// See https://github.com/AztecProtocol/aztec-packages/issues/5615
class WorkaroundMulticallEntrypointWithClaimAsFee implements EntrypointInterface {
  constructor(
    private address: AztecAddress,
    private chainId: number,
    private version: number,
    private claimAmount: bigint,
    private claimSecret: Fr,
  ) {}

  createTxExecutionRequest(exec: ExecutionRequestInit): Promise<TxExecutionRequest> {
    const { calls, fee, authWitnesses = [], packedArguments = [] } = exec;

    const claim = {
      to: GasTokenAddress,
      name: 'claim',
      selector: FunctionSelector.fromSignature('claim((Field),Field,Field)'),
      isStatic: false,
      args: [this.address, new Fr(this.claimAmount), this.claimSecret],
      returnTypes: [],
      type: FunctionType.PRIVATE,
    };

    const appPayload = EntrypointPayload.fromAppExecution(calls);
    const feePayload = MulticallEntrypointFeePayload.fromMulticallFunctionCalls([claim]);

    const abi = this.getEntrypointAbi();
    const entrypointPackedArgs = PackedValues.fromValues(encodeArguments(abi, [appPayload, feePayload]));
    const gasSettings = fee?.gasSettings ?? GasSettings.default();

    const txRequest = TxExecutionRequest.from({
      firstCallArgsHash: entrypointPackedArgs.hash,
      origin: this.address,
      functionSelector: FunctionSelector.fromNameAndParameters(abi.name, abi.parameters),
      txContext: new TxContext(this.chainId, this.version, gasSettings),
      argsOfCalls: [
        ...appPayload.packedArguments,
        ...feePayload.packedArguments,
        ...packedArguments,
        entrypointPackedArgs,
      ],
      authWitnesses,
    });

    return Promise.resolve(txRequest);
  }

  private getEntrypointAbi() {
    return {
      name: 'entrypoint_with_fee',
      isInitializer: false,
      functionType: 'private',
      isInternal: false,
      isStatic: false,
      parameters: [
        {
          name: 'app_payload',
          type: {
            kind: 'struct',
            path: 'authwit::entrypoint::app::AppPayload',
            fields: [
              {
                name: 'function_calls',
                type: {
                  kind: 'array',
                  length: 4,
                  type: {
                    kind: 'struct',
                    path: 'authwit::entrypoint::function_call::FunctionCall',
                    fields: [
                      { name: 'args_hash', type: { kind: 'field' } },
                      {
                        name: 'function_selector',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::abis::function_selector::FunctionSelector',
                          fields: [{ name: 'inner', type: { kind: 'integer', sign: 'unsigned', width: 32 } }],
                        },
                      },
                      {
                        name: 'target_address',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::address::AztecAddress',
                          fields: [{ name: 'inner', type: { kind: 'field' } }],
                        },
                      },
                      { name: 'is_public', type: { kind: 'boolean' } },
                      { name: 'is_static', type: { kind: 'boolean' } },
                    ],
                  },
                },
              },
              { name: 'nonce', type: { kind: 'field' } },
            ],
          },
          visibility: 'public',
        },
        {
          name: 'fee_payload',
          type: {
            kind: 'struct',
            path: 'authwit::entrypoint::fee::FeePayload',
            fields: [
              {
                name: 'function_calls',
                type: {
                  kind: 'array',
                  length: 2,
                  type: {
                    kind: 'struct',
                    path: 'authwit::entrypoint::function_call::FunctionCall',
                    fields: [
                      { name: 'args_hash', type: { kind: 'field' } },
                      {
                        name: 'function_selector',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::abis::function_selector::FunctionSelector',
                          fields: [{ name: 'inner', type: { kind: 'integer', sign: 'unsigned', width: 32 } }],
                        },
                      },
                      {
                        name: 'target_address',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::address::AztecAddress',
                          fields: [{ name: 'inner', type: { kind: 'field' } }],
                        },
                      },
                      { name: 'is_public', type: { kind: 'boolean' } },
                      { name: 'is_static', type: { kind: 'boolean' } },
                    ],
                  },
                },
              },
              { name: 'nonce', type: { kind: 'field' } },
              { name: 'is_fee_payer', type: { kind: 'boolean' } },
            ],
          },
          visibility: 'public',
        },
      ],
      returnTypes: [],
    } as FunctionAbi;
  }
}

class MulticallEntrypointFeePayload extends EntrypointPayload {
  static fromMulticallFunctionCalls(functionCalls: FunctionCall[]): MulticallEntrypointFeePayload {
    const paddedCalls = padArrayEnd(functionCalls, FunctionCall.empty(), 2);
    return new MulticallEntrypointFeePayload(paddedCalls, GeneratorIndex.FEE_PAYLOAD);
  }
  override toFields(): Fr[] {
    return [...this.functionCallsToFields(), this.nonce];
  }
}
