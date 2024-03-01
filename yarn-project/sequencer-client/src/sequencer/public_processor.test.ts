import {
  ExtendedContractData,
  FunctionCall,
  FunctionL2Logs,
  SiblingPath,
  SimulationError,
  Tx,
  TxL2Logs,
  mockTx,
} from '@aztec/circuit-types';
import {
  ARGS_LENGTH,
  AztecAddress,
  CallContext,
  CallRequest,
  ContractStorageUpdateRequest,
  EthAddress,
  Fr,
  FunctionData,
  GlobalVariables,
  Header,
  MAX_NON_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
  MAX_PRIVATE_CALL_STACK_LENGTH_PER_TX,
  MAX_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
  PUBLIC_DATA_TREE_HEIGHT,
  PrivateKernelTailCircuitPublicInputs,
  Proof,
  PublicAccumulatedNonRevertibleData,
  PublicAccumulatedRevertibleData,
  PublicCallRequest,
  PublicDataUpdateRequest,
  PublicKernelCircuitPublicInputs,
  makeEmptyProof,
} from '@aztec/circuits.js';
import { computePublicDataTreeLeafSlot } from '@aztec/circuits.js/hash';
import {
  fr,
  makeAztecAddress,
  makePrivateKernelTailCircuitPublicInputs,
  makePublicCallRequest,
  makeSelector,
} from '@aztec/circuits.js/testing';
import { makeTuple } from '@aztec/foundation/array';
import { arrayNonEmptyLength, padArrayEnd, times } from '@aztec/foundation/collection';
import { PublicExecution, PublicExecutionResult, PublicExecutor } from '@aztec/simulator';
import { MerkleTreeOperations, TreeInfo } from '@aztec/world-state';

import { jest } from '@jest/globals';
import { MockProxy, mock } from 'jest-mock-extended';

import { PublicProver } from '../prover/index.js';
import { PublicKernelCircuitSimulator } from '../simulator/index.js';
import { ContractsDataSourcePublicDB, WorldStatePublicDB } from '../simulator/public_executor.js';
import { RealPublicKernelCircuitSimulator } from '../simulator/public_kernel.js';
import { ProcessedTx } from './processed_tx.js';
import { PublicProcessor } from './public_processor.js';

describe('public_processor', () => {
  let db: MockProxy<MerkleTreeOperations>;
  let publicExecutor: MockProxy<PublicExecutor>;
  let publicProver: MockProxy<PublicProver>;
  let publicContractsDB: MockProxy<ContractsDataSourcePublicDB>;
  let publicWorldStateDB: MockProxy<WorldStatePublicDB>;

  let proof: Proof;
  let root: Buffer;

  let processor: PublicProcessor;

  beforeEach(() => {
    db = mock<MerkleTreeOperations>();
    publicExecutor = mock<PublicExecutor>();
    publicProver = mock<PublicProver>();
    publicContractsDB = mock<ContractsDataSourcePublicDB>();
    publicWorldStateDB = mock<WorldStatePublicDB>();

    proof = makeEmptyProof();
    root = Buffer.alloc(32, 5);

    publicProver.getPublicCircuitProof.mockResolvedValue(proof);
    publicProver.getPublicKernelCircuitProof.mockResolvedValue(proof);
    db.getTreeInfo.mockResolvedValue({ root } as TreeInfo);
  });

  describe('with mock circuits', () => {
    let publicKernel: MockProxy<PublicKernelCircuitSimulator>;

    beforeEach(() => {
      publicKernel = mock<PublicKernelCircuitSimulator>();
      processor = new PublicProcessor(
        db,
        publicExecutor,
        publicKernel,
        publicProver,
        GlobalVariables.empty(),
        Header.empty(),
        publicContractsDB,
        publicWorldStateDB,
      );
    });

    it('skips txs without public execution requests', async function () {
      const tx = mockTx();
      tx.data.end.publicCallStack = makeTuple(MAX_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX, CallRequest.empty);
      tx.data.endNonRevertibleData.publicCallStack = makeTuple(
        MAX_NON_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
        CallRequest.empty,
      );
      tx.data.needsSetup = false;
      tx.data.needsAppLogic = false;
      tx.data.needsTeardown = false;

      const hash = tx.getTxHash();
      const [processed, failed] = await processor.process([tx]);

      expect(processed.length).toBe(1);

      const p = processed[0];
      const e = {
        hash,
        data: new PublicKernelCircuitPublicInputs(
          tx.data.aggregationObject,
          PublicAccumulatedNonRevertibleData.fromPrivateAccumulatedNonRevertibleData(tx.data.endNonRevertibleData),
          PublicAccumulatedRevertibleData.fromPrivateAccumulatedRevertibleData(tx.data.end),
          tx.data.constants,
          tx.data.needsSetup,
          tx.data.needsAppLogic,
          tx.data.needsTeardown,
          false, // reverted
        ),
        proof: tx.proof,
        encryptedLogs: tx.encryptedLogs,
        unencryptedLogs: tx.unencryptedLogs,
        newContracts: tx.newContracts,
        isEmpty: false,
      };

      // Jest is complaining that the two objects are not equal, but they are.
      // It expects something and says "Received: serializes to the same string"
      // TODO why can't we just expect(p).toEqual(e) here anymore?
      expect(Object.keys(p)).toEqual(Object.keys(e));
      for (const key in e) {
        if (key === 'data') {
          expect(p.data.toBuffer()).toEqual(e.data.toBuffer());
        } else {
          expect(p[key as keyof ProcessedTx]).toEqual(e[key as keyof ProcessedTx]);
        }
      }

      expect(failed).toEqual([]);
    });

    it('returns failed txs without aborting entire operation', async function () {
      publicExecutor.simulate.mockRejectedValue(new Error(`Failed`));

      const tx = mockTx();
      const [processed, failed] = await processor.process([tx]);

      expect(processed).toEqual([]);
      expect(failed[0].tx).toEqual(tx);
      expect(publicWorldStateDB.commit).toHaveBeenCalledTimes(1);
      expect(publicWorldStateDB.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe('with actual circuits', () => {
    let publicKernel: PublicKernelCircuitSimulator;

    beforeEach(() => {
      const path = times(PUBLIC_DATA_TREE_HEIGHT, i => Buffer.alloc(32, i));
      db.getSiblingPath.mockResolvedValue(new SiblingPath<number>(PUBLIC_DATA_TREE_HEIGHT, path));
      publicKernel = new RealPublicKernelCircuitSimulator();
      processor = new PublicProcessor(
        db,
        publicExecutor,
        publicKernel,
        publicProver,
        GlobalVariables.empty(),
        Header.empty(),
        publicContractsDB,
        publicWorldStateDB,
      );
    });

    const expectedTxByHash = (tx: Tx) =>
      expect.objectContaining({
        hash: tx.getTxHash(),
        proof,
      });

    it('runs a tx with enqueued public calls', async function () {
      const publicCallRequests: PublicCallRequest[] = [makePublicCallRequest(0x100), makePublicCallRequest(0x100)];
      const callRequests = publicCallRequests.map(call => call.toCallRequest());

      const kernelOutput = makePrivateKernelTailCircuitPublicInputs(0x10);
      kernelOutput.end.publicCallStack = padArrayEnd(
        callRequests,
        CallRequest.empty(),
        MAX_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
      );
      kernelOutput.end.privateCallStack = padArrayEnd([], CallRequest.empty(), MAX_PRIVATE_CALL_STACK_LENGTH_PER_TX);

      kernelOutput.endNonRevertibleData.publicCallStack = makeTuple(
        MAX_NON_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
        CallRequest.empty,
      );

      const tx = new Tx(kernelOutput, proof, TxL2Logs.random(2, 3), TxL2Logs.random(3, 2), publicCallRequests, [
        ExtendedContractData.random(),
      ]);

      tx.data.needsSetup = false;
      tx.data.needsTeardown = false;

      publicExecutor.simulate.mockImplementation(execution => {
        for (const request of publicCallRequests) {
          if (execution.contractAddress.equals(request.contractAddress)) {
            return Promise.resolve(PublicExecutionResultBuilder.fromPublicCallRequest({ request }).build());
          }
        }
        throw new Error(`Unexpected execution request: ${execution}`);
      });

      const [processed, failed] = await processor.process([tx]);

      expect(processed).toHaveLength(1);
      expect(processed).toEqual([expectedTxByHash(tx)]);
      expect(failed).toHaveLength(0);
      expect(publicExecutor.simulate).toHaveBeenCalledTimes(2);
      expect(publicWorldStateDB.commit).toHaveBeenCalledTimes(1);
      expect(publicWorldStateDB.rollback).toHaveBeenCalledTimes(0);
    });

    it('runs a tx with an enqueued public call with nested execution', async function () {
      const callRequest: PublicCallRequest = makePublicCallRequest(0x100);
      const callStackItem = callRequest.toCallRequest();

      const kernelOutput = makePrivateKernelTailCircuitPublicInputs(0x10);
      kernelOutput.end.publicCallStack = padArrayEnd(
        [callStackItem],
        CallRequest.empty(),
        MAX_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
      );
      kernelOutput.end.privateCallStack = padArrayEnd([], CallRequest.empty(), MAX_PRIVATE_CALL_STACK_LENGTH_PER_TX);
      kernelOutput.endNonRevertibleData.publicCallStack = makeTuple(
        MAX_NON_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
        CallRequest.empty,
      );

      kernelOutput.needsSetup = false;
      kernelOutput.needsTeardown = false;

      const tx = new Tx(
        kernelOutput,
        proof,
        TxL2Logs.random(2, 3),
        TxL2Logs.random(3, 2),
        [callRequest],
        [ExtendedContractData.random()],
      );

      const publicExecutionResult = PublicExecutionResultBuilder.fromPublicCallRequest({
        request: callRequest,
        nestedExecutions: [
          PublicExecutionResultBuilder.fromFunctionCall({
            from: callRequest.contractAddress,
            tx: makeFunctionCall(),
          }).build(),
        ],
      }).build();

      publicExecutor.simulate.mockResolvedValue(publicExecutionResult);

      const [processed, failed] = await processor.process([tx]);

      expect(processed).toHaveLength(1);
      expect(processed).toEqual([expectedTxByHash(tx)]);
      expect(failed).toHaveLength(0);
      expect(publicExecutor.simulate).toHaveBeenCalledTimes(1);
      expect(publicWorldStateDB.commit).toHaveBeenCalledTimes(1);
      expect(publicWorldStateDB.rollback).toHaveBeenCalledTimes(0);
    });

    it('rolls back app logic db updates on failed public execution, but persists setup/teardown', async function () {
      const baseContractAddressSeed = 0x200;
      const baseContractAddress = makeAztecAddress(baseContractAddressSeed);
      const callRequests: PublicCallRequest[] = [
        baseContractAddressSeed,
        baseContractAddressSeed,
        baseContractAddressSeed,
      ].map(makePublicCallRequest);
      callRequests[0].callContext.startSideEffectCounter = 2;
      callRequests[1].callContext.startSideEffectCounter = 3;
      callRequests[2].callContext.startSideEffectCounter = 4;

      const kernelOutput = makePrivateKernelTailCircuitPublicInputs(0x10);

      addKernelPublicCallStack(kernelOutput, {
        setupCalls: [callRequests[0]],
        appLogicCalls: [callRequests[2]],
        teardownCall: callRequests[1],
      });

      const tx = new Tx(
        kernelOutput,
        proof,
        TxL2Logs.random(2, 3),
        TxL2Logs.random(3, 2),
        // reverse because `enqueuedPublicFunctions` expects the last element to be the front of the queue
        callRequests.slice().reverse(),
        [ExtendedContractData.random()],
      );

      // const enqueuedExecutionContractAddress = makeAztecAddress(30);
      const enqueuedExecutionContractAddress = baseContractAddress;
      const contractSlotA = fr(0x100);
      const contractSlotB = fr(0x150);
      const contractSlotC = fr(0x200);

      let simulatorCallCount = 0;
      const simulatorResults: PublicExecutionResult[] = [
        // Setup
        PublicExecutionResultBuilder.fromPublicCallRequest({
          request: callRequests[0],
          contractStorageUpdateRequests: [new ContractStorageUpdateRequest(contractSlotA, fr(0x101))],
        }).build(),

        // App Logic
        PublicExecutionResultBuilder.fromPublicCallRequest({
          request: callRequests[2],
          nestedExecutions: [
            PublicExecutionResultBuilder.fromFunctionCall({
              from: callRequests[1].contractAddress,
              tx: makeFunctionCall(enqueuedExecutionContractAddress, makeSelector(5)),
              contractStorageUpdateRequests: [
                new ContractStorageUpdateRequest(contractSlotA, fr(0x102)),
                new ContractStorageUpdateRequest(contractSlotB, fr(0x151)),
              ],
            }).build(),
            PublicExecutionResultBuilder.fromFunctionCall({
              from: callRequests[1].contractAddress,
              tx: makeFunctionCall(enqueuedExecutionContractAddress, makeSelector(5)),
              revertReason: new SimulationError('Simulation Failed', []),
            }).build(),
          ],
        }).build(),

        // Teardown
        PublicExecutionResultBuilder.fromPublicCallRequest({
          request: callRequests[1],
          nestedExecutions: [
            PublicExecutionResultBuilder.fromFunctionCall({
              from: callRequests[1].contractAddress,
              tx: makeFunctionCall(enqueuedExecutionContractAddress, makeSelector(5)),
              contractStorageUpdateRequests: [new ContractStorageUpdateRequest(contractSlotC, fr(0x201))],
            }).build(),
          ],
        }).build(),
      ];

      publicExecutor.simulate.mockImplementation(execution => {
        if (simulatorCallCount < simulatorResults.length) {
          return Promise.resolve(simulatorResults[simulatorCallCount++]);
        } else {
          throw new Error(`Unexpected execution request: ${execution}, call count: ${simulatorCallCount}`);
        }
      });

      const setupSpy = jest.spyOn(publicKernel, 'publicKernelCircuitSetup');
      const appLogicSpy = jest.spyOn(publicKernel, 'publicKernelCircuitAppLogic');
      const teardownSpy = jest.spyOn(publicKernel, 'publicKernelCircuitTeardown');

      const [processed, failed] = await processor.process([tx]);

      expect(processed).toHaveLength(1);
      expect(processed).toEqual([expectedTxByHash(tx)]);
      expect(failed).toHaveLength(0);

      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(appLogicSpy).toHaveBeenCalledTimes(2);
      expect(teardownSpy).toHaveBeenCalledTimes(2);
      expect(publicExecutor.simulate).toHaveBeenCalledTimes(3);
      expect(publicWorldStateDB.commit).toHaveBeenCalledTimes(3);
      expect(publicWorldStateDB.rollback).toHaveBeenCalledTimes(0);
      expect(
        arrayNonEmptyLength(processed[0].data.combinedData.publicDataUpdateRequests, PublicDataUpdateRequest.isEmpty),
      ).toEqual(2);
      expect(processed[0].data.combinedData.publicDataUpdateRequests[0]).toEqual(
        new PublicDataUpdateRequest(computePublicDataTreeLeafSlot(baseContractAddress, contractSlotA), fr(0x101)),
      );
      expect(processed[0].data.combinedData.publicDataUpdateRequests[1]).toEqual(
        new PublicDataUpdateRequest(
          computePublicDataTreeLeafSlot(enqueuedExecutionContractAddress, contractSlotC),
          fr(0x201),
        ),
      );
    });

    it('runs a tx with setup and teardown phases', async function () {
      const baseContractAddressSeed = 0x200;
      const baseContractAddress = makeAztecAddress(baseContractAddressSeed);
      const callRequests: PublicCallRequest[] = [
        baseContractAddressSeed,
        baseContractAddressSeed,
        baseContractAddressSeed,
      ].map(makePublicCallRequest);
      callRequests[0].callContext.startSideEffectCounter = 2;
      callRequests[1].callContext.startSideEffectCounter = 3;
      callRequests[2].callContext.startSideEffectCounter = 4;

      const kernelOutput = makePrivateKernelTailCircuitPublicInputs(0x10);

      addKernelPublicCallStack(kernelOutput, {
        setupCalls: [callRequests[0]],
        appLogicCalls: [callRequests[2]],
        teardownCall: callRequests[1],
      });

      const tx = new Tx(
        kernelOutput,
        proof,
        TxL2Logs.random(2, 3),
        TxL2Logs.random(3, 2),
        // reverse because `enqueuedPublicFunctions` expects the last element to be the front of the queue
        callRequests.slice().reverse(),
        [ExtendedContractData.random()],
      );

      // const enqueuedExecutionContractAddress = makeAztecAddress(30);
      const enqueuedExecutionContractAddress = baseContractAddress;
      const contractSlotA = fr(0x100);
      const contractSlotB = fr(0x150);
      const contractSlotC = fr(0x200);

      let simulatorCallCount = 0;
      const simulatorResults: PublicExecutionResult[] = [
        // Setup
        PublicExecutionResultBuilder.fromPublicCallRequest({ request: callRequests[0] }).build(),

        // App Logic
        PublicExecutionResultBuilder.fromPublicCallRequest({
          request: callRequests[2],
          contractStorageUpdateRequests: [
            new ContractStorageUpdateRequest(contractSlotA, fr(0x101)),
            new ContractStorageUpdateRequest(contractSlotB, fr(0x151)),
          ],
        }).build(),

        // Teardown
        PublicExecutionResultBuilder.fromPublicCallRequest({
          request: callRequests[1],
          nestedExecutions: [
            PublicExecutionResultBuilder.fromFunctionCall({
              from: callRequests[1].contractAddress,
              tx: makeFunctionCall(enqueuedExecutionContractAddress, makeSelector(5)),
              contractStorageUpdateRequests: [
                new ContractStorageUpdateRequest(contractSlotA, fr(0x101)),
                new ContractStorageUpdateRequest(contractSlotC, fr(0x201)),
              ],
            }).build(),
            PublicExecutionResultBuilder.fromFunctionCall({
              from: callRequests[1].contractAddress,
              tx: makeFunctionCall(enqueuedExecutionContractAddress, makeSelector(5)),
              contractStorageUpdateRequests: [new ContractStorageUpdateRequest(contractSlotA, fr(0x102))],
            }).build(),
          ],
        }).build(),
      ];

      publicExecutor.simulate.mockImplementation(execution => {
        if (simulatorCallCount < simulatorResults.length) {
          return Promise.resolve(simulatorResults[simulatorCallCount++]);
        } else {
          throw new Error(`Unexpected execution request: ${execution}, call count: ${simulatorCallCount}`);
        }
      });

      const setupSpy = jest.spyOn(publicKernel, 'publicKernelCircuitSetup');
      const appLogicSpy = jest.spyOn(publicKernel, 'publicKernelCircuitAppLogic');
      const teardownSpy = jest.spyOn(publicKernel, 'publicKernelCircuitTeardown');

      const [processed, failed] = await processor.process([tx]);

      expect(processed).toHaveLength(1);
      expect(processed).toEqual([expectedTxByHash(tx)]);
      expect(failed).toHaveLength(0);

      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(appLogicSpy).toHaveBeenCalledTimes(1);
      expect(teardownSpy).toHaveBeenCalledTimes(3);
      expect(publicExecutor.simulate).toHaveBeenCalledTimes(3);
      expect(publicWorldStateDB.commit).toHaveBeenCalledTimes(3);
      expect(publicWorldStateDB.rollback).toHaveBeenCalledTimes(0);
      expect(
        arrayNonEmptyLength(processed[0].data.combinedData.publicDataUpdateRequests, PublicDataUpdateRequest.isEmpty),
      ).toEqual(3);
      expect(processed[0].data.combinedData.publicDataUpdateRequests[0]).toEqual(
        new PublicDataUpdateRequest(computePublicDataTreeLeafSlot(baseContractAddress, contractSlotA), fr(0x102)),
      );
      expect(processed[0].data.combinedData.publicDataUpdateRequests[1]).toEqual(
        new PublicDataUpdateRequest(
          computePublicDataTreeLeafSlot(enqueuedExecutionContractAddress, contractSlotB),
          fr(0x151),
        ),
      );
      expect(processed[0].data.combinedData.publicDataUpdateRequests[2]).toEqual(
        new PublicDataUpdateRequest(
          computePublicDataTreeLeafSlot(enqueuedExecutionContractAddress, contractSlotC),
          fr(0x201),
        ),
      );
    });
  });
});

class PublicExecutionResultBuilder {
  private _execution: PublicExecution;
  private _nestedExecutions: PublicExecutionResult[] = [];
  private _contractStorageUpdateRequests: ContractStorageUpdateRequest[] = [];
  private _returnValues: Fr[] = [];
  private _reverted = false;
  private _revertReason: Error | undefined = undefined;

  constructor(execution: PublicExecution) {
    this._execution = execution;
  }

  static fromPublicCallRequest({
    request,
    returnValues = [new Fr(1n)],
    nestedExecutions = [],
    contractStorageUpdateRequests = [],
  }: {
    request: PublicCallRequest;
    returnValues?: Fr[];
    nestedExecutions?: PublicExecutionResult[];
    contractStorageUpdateRequests?: ContractStorageUpdateRequest[];
  }): PublicExecutionResultBuilder {
    const builder = new PublicExecutionResultBuilder(request);

    builder.withNestedExecutions(...nestedExecutions);
    builder.withContractStorageUpdateRequest(...contractStorageUpdateRequests);
    builder.withReturnValues(...returnValues);

    return builder;
  }

  static fromFunctionCall({
    from,
    tx,
    returnValues = [new Fr(1n)],
    nestedExecutions = [],
    contractStorageUpdateRequests = [],
    revertReason,
  }: {
    from: AztecAddress;
    tx: FunctionCall;
    returnValues?: Fr[];
    nestedExecutions?: PublicExecutionResult[];
    contractStorageUpdateRequests?: ContractStorageUpdateRequest[];
    revertReason?: Error;
  }) {
    const builder = new PublicExecutionResultBuilder({
      callContext: new CallContext(from, tx.to, EthAddress.ZERO, tx.functionData.selector, false, false, false, 0),
      contractAddress: tx.to,
      functionData: tx.functionData,
      args: tx.args,
    });

    builder.withNestedExecutions(...nestedExecutions);
    builder.withContractStorageUpdateRequest(...contractStorageUpdateRequests);
    builder.withReturnValues(...returnValues);
    if (revertReason) {
      builder.withReverted(revertReason);
    }

    return builder;
  }

  withNestedExecutions(...nested: PublicExecutionResult[]): PublicExecutionResultBuilder {
    this._nestedExecutions.push(...nested);
    return this;
  }

  withContractStorageUpdateRequest(...request: ContractStorageUpdateRequest[]): PublicExecutionResultBuilder {
    this._contractStorageUpdateRequests.push(...request);
    return this;
  }

  withReturnValues(...values: Fr[]): PublicExecutionResultBuilder {
    this._returnValues.push(...values);
    return this;
  }

  withReverted(reason: Error): PublicExecutionResultBuilder {
    this._reverted = true;
    this._revertReason = reason;
    return this;
  }

  build(): PublicExecutionResult {
    return {
      execution: this._execution,
      nestedExecutions: this._nestedExecutions,
      contractStorageUpdateRequests: this._contractStorageUpdateRequests,
      returnValues: this._returnValues,
      newNoteHashes: [],
      newNullifiers: [],
      newL2ToL1Messages: [],
      contractStorageReads: [],
      unencryptedLogs: new FunctionL2Logs([]),
      reverted: this._reverted,
      revertReason: this._revertReason,
    };
  }
}

const makeFunctionCall = (
  to = makeAztecAddress(30),
  selector = makeSelector(5),
  args = new Array(ARGS_LENGTH).fill(Fr.ZERO),
) => ({
  to,
  functionData: new FunctionData(selector, false, false, false),
  args,
});

function addKernelPublicCallStack(
  kernelOutput: PrivateKernelTailCircuitPublicInputs,
  calls: {
    setupCalls: PublicCallRequest[];
    appLogicCalls: PublicCallRequest[];
    teardownCall: PublicCallRequest;
  },
) {
  // the first two calls are non-revertible
  // the first is for setup, the second is for teardown
  kernelOutput.endNonRevertibleData.publicCallStack = padArrayEnd(
    // this is a stack, so the first item is the last call
    // and callRequests is in the order of the calls
    [calls.teardownCall.toCallRequest(), ...calls.setupCalls.map(c => c.toCallRequest())],
    CallRequest.empty(),
    MAX_NON_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
  );

  kernelOutput.end.publicCallStack = padArrayEnd(
    calls.appLogicCalls.map(c => c.toCallRequest()),
    CallRequest.empty(),
    MAX_REVERTIBLE_PUBLIC_CALL_STACK_LENGTH_PER_TX,
  );
  kernelOutput.end.privateCallStack = padArrayEnd([], CallRequest.empty(), MAX_PRIVATE_CALL_STACK_LENGTH_PER_TX);
}
