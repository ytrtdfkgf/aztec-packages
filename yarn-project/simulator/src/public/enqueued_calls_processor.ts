import {
  type AvmProvingRequest,
  type GasUsed,
  type MerkleTreeReadOperations,
  type NestedProcessReturnValues,
  type PublicExecutionRequest,
  type SimulationError,
  type Tx,
  TxExecutionPhase,
} from '@aztec/circuit-types';
import {
  AvmAccumulatedData,
  AvmCircuitPublicInputs,
  type CombinedAccumulatedData,
  CombinedConstantData,
  EnqueuedCallData,
  Fr,
  Gas,
  type GlobalVariables,
  type Header,
  type KernelCircuitPublicInputs,
  MAX_L2_TO_L1_MSGS_PER_TX,
  MAX_NOTE_HASHES_PER_TX,
  MAX_NULLIFIERS_PER_TX,
  MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,
  MAX_UNENCRYPTED_LOGS_PER_TX,
  NESTED_RECURSIVE_PROOF_LENGTH,
  type PrivateKernelTailCircuitPublicInputs,
  PrivateToAvmAccumulatedData,
  PrivateToAvmAccumulatedDataArrayLengths,
  type PrivateToPublicAccumulatedData,
  PublicAccumulatedData,
  PublicAccumulatedDataArrayLengths,
  type PublicCallRequest,
  PublicDataWrite,
  PublicKernelCircuitPrivateInputs,
  PublicKernelCircuitPublicInputs,
  PublicKernelData,
  PublicValidationRequestArrayLengths,
  PublicValidationRequests,
  RevertCode,
  type StateReference,
  TreeSnapshots,
  type VMCircuitPublicInputs,
  VerificationKeyData,
  countAccumulatedItems,
  makeEmptyProof,
  makeEmptyRecursiveProof,
  mergeAccumulatedData,
} from '@aztec/circuits.js';
import { padArrayEnd } from '@aztec/foundation/collection';
import { type DebugLogger, createDebugLogger } from '@aztec/foundation/log';
import { assertLength } from '@aztec/foundation/serialize';
import { Timer } from '@aztec/foundation/timer';
import { getVKSiblingPath } from '@aztec/noir-protocol-circuits-types';

import { assert } from 'console';
import { inspect } from 'util';

import { AvmPersistableStateManager } from '../avm/journal/journal.js';
import { DualSideEffectTrace } from './dual_side_effect_trace.js';
import { PublicEnqueuedCallSideEffectTrace } from './enqueued_call_side_effect_trace.js';
import { EnqueuedCallSimulator } from './enqueued_call_simulator.js';
import { type PublicExecutor } from './executor.js';
import { type WorldStateDB } from './public_db_sources.js';
import { type PublicKernelCircuitSimulator } from './public_kernel_circuit_simulator.js';
import { PublicKernelTailSimulator } from './public_kernel_tail_simulator.js';
import { PublicSideEffectTrace } from './side_effect_trace.js';

const PhaseIsRevertible: Record<TxExecutionPhase, boolean> = {
  [TxExecutionPhase.SETUP]: false,
  [TxExecutionPhase.APP_LOGIC]: true,
  [TxExecutionPhase.TEARDOWN]: true,
};

type PublicPhaseResult = {
  avmProvingRequest: AvmProvingRequest;
  /** The output of the public kernel circuit simulation for this phase */
  publicKernelOutput: PublicKernelCircuitPublicInputs;
  /** Return values of simulating complete callstack */
  returnValues: NestedProcessReturnValues[];
  /** Gas used during the execution of this phase */
  gasUsed: Gas;
  /** Time spent for the execution this phase */
  durationMs: number;
  /** Reverted */
  reverted: boolean;
  /** Revert reason, if any */
  revertReason?: SimulationError;
};

type PhaseGasUsed = Record<TxExecutionPhase, Gas>;

export type ProcessedPhase = {
  phase: TxExecutionPhase;
  durationMs: number;
  returnValues: NestedProcessReturnValues[];
  reverted: boolean;
  revertReason?: SimulationError;
};

export type TxPublicCallsResult = {
  avmProvingRequest: AvmProvingRequest;
  /** Gas used during the execution of this tx */
  gasUsed: GasUsed;
  revertCode: RevertCode;
  /** Revert reason, if any */
  revertReason?: SimulationError;
  processedPhases: ProcessedPhase[];
};

export class EnqueuedCallsProcessor {
  private log: DebugLogger;

  constructor(
    private db: MerkleTreeReadOperations,
    private publicKernelSimulator: PublicKernelCircuitSimulator,
    private globalVariables: GlobalVariables,
    private worldStateDB: WorldStateDB,
    private enqueuedCallSimulator: EnqueuedCallSimulator,
    private publicKernelTailSimulator: PublicKernelTailSimulator,
  ) {
    this.log = createDebugLogger(`aztec:sequencer`);
  }

  static create(
    db: MerkleTreeReadOperations,
    publicExecutor: PublicExecutor,
    publicKernelSimulator: PublicKernelCircuitSimulator,
    globalVariables: GlobalVariables,
    historicalHeader: Header,
    worldStateDB: WorldStateDB,
    realAvmProvingRequests: boolean = true,
  ) {
    const enqueuedCallSimulator = new EnqueuedCallSimulator(
      db,
      worldStateDB,
      publicExecutor,
      globalVariables,
      historicalHeader,
      realAvmProvingRequests,
    );

    const publicKernelTailSimulator = PublicKernelTailSimulator.create(db, publicKernelSimulator);

    return new EnqueuedCallsProcessor(
      db,
      publicKernelSimulator,
      globalVariables,
      worldStateDB,
      enqueuedCallSimulator,
      publicKernelTailSimulator,
    );
  }

  static getExecutionRequestsByPhase(tx: Tx, phase: TxExecutionPhase): PublicExecutionRequest[] {
    switch (phase) {
      case TxExecutionPhase.SETUP:
        return tx.getNonRevertiblePublicExecutionRequests();
      case TxExecutionPhase.APP_LOGIC:
        return tx.getRevertiblePublicExecutionRequests();
      case TxExecutionPhase.TEARDOWN: {
        const request = tx.getPublicTeardownExecutionRequest();
        return request ? [request] : [];
      }
      default:
        throw new Error(`Unknown phase: ${phase}`);
    }
  }

  static getCallRequestsByPhase(tx: Tx, phase: TxExecutionPhase): PublicCallRequest[] {
    switch (phase) {
      case TxExecutionPhase.SETUP:
        return tx.data.getNonRevertiblePublicCallRequests();
      case TxExecutionPhase.APP_LOGIC:
        return tx.data.getRevertiblePublicCallRequests();
      case TxExecutionPhase.TEARDOWN: {
        const request = tx.data.getTeardownPublicCallRequest();
        return request ? [request] : [];
      }
      default:
        throw new Error(`Unknown phase: ${phase}`);
    }
  }

  async process(tx: Tx): Promise<TxPublicCallsResult> {
    this.log.verbose(`Processing tx ${tx.getTxHash()}`);

    const constants = CombinedConstantData.combine(tx.data.constants, this.globalVariables);
    let phaseGasUsed: PhaseGasUsed = {
      [TxExecutionPhase.SETUP]: Gas.empty(),
      [TxExecutionPhase.APP_LOGIC]: Gas.empty(),
      [TxExecutionPhase.TEARDOWN]: Gas.empty(),
    };
    const firstPublicKernelOutput = this.getPublicKernelCircuitPublicInputs(tx.data);
    const publicKernelOutput = firstPublicKernelOutput;
    const startStateReference = await this.db.getStateReference();
    /*
     * Don't need to fork at all during setup because it's non-revertible.
     * Fork at start of app phase (if app logic exists).
     * Don't fork for any app subsequent enqueued calls because if any one fails, all of app logic reverts.
     * If app logic reverts, rollback to end of setup and fork again for teardown.
     * If app logic succeeds, don't fork for teardown.
     * If teardown reverts, rollback to end of setup.
     * If teardown succeeds, accept/merge all state changes from app logic.
     *
     */
    // rename merge to rollback/merge

    const nonRevertibleNullifiersFromPrivate = publicKernelOutput.endNonRevertibleData.nullifiers
      .filter(n => !n.isEmpty())
      .map(n => n.value);
    const _revertibleNullifiersFromPrivate = publicKernelOutput.end.nullifiers
      .filter(n => !n.isEmpty())
      .map(n => n.value);

    // During SETUP, non revertible side effects from private are our "previous data"
    const prevAccumulatedData = publicKernelOutput.endNonRevertibleData;
    const previousValidationRequestArrayLengths = PublicValidationRequestArrayLengths.new(
      publicKernelOutput.validationRequests,
    );

    const previousAccumulatedDataArrayLengths = PublicAccumulatedDataArrayLengths.new(prevAccumulatedData);
    const innerCallTrace = new PublicSideEffectTrace();
    const enqueuedCallTrace = new PublicEnqueuedCallSideEffectTrace(
      /*startSideEffectCounter=*/ 0,
      previousValidationRequestArrayLengths,
      previousAccumulatedDataArrayLengths,
    );
    const trace = new DualSideEffectTrace(innerCallTrace, enqueuedCallTrace);

    // Transaction level state manager that will be forked for revertible phases.
    const txStateManager = AvmPersistableStateManager.newWithPendingSiloedNullifiers(
      this.worldStateDB,
      trace,
      nonRevertibleNullifiersFromPrivate,
    );

    const state = new PhaseStateManager(txStateManager);

    const setupResult = await this.processSetupPhase(state, tx, constants, phaseGasUsed, publicKernelOutput);
    if (setupResult) {
      phaseGasUsed = {
        ...phaseGasUsed,
        [TxExecutionPhase.SETUP]: setupResult.gasUsed,
      };
    }

    const appLogicResult = await this.processAppLogicPhase(state, tx, constants, phaseGasUsed, publicKernelOutput);
    if (appLogicResult) {
      phaseGasUsed = {
        ...phaseGasUsed,
        [TxExecutionPhase.APP_LOGIC]: appLogicResult.gasUsed,
      };
    }

    const teardownResult = await this.processTeardownPhase(state, tx, constants, phaseGasUsed, publicKernelOutput);
    if (teardownResult) {
      phaseGasUsed = {
        ...phaseGasUsed,
        [TxExecutionPhase.TEARDOWN]: teardownResult.gasUsed,
      };
    }

    //const reverted = setupResult?.reverted || appLogicResult?.reverted || teardownResult?.reverted;
    const revertReason: SimulationError | undefined =
      teardownResult?.revertReason || appLogicResult?.revertReason || setupResult?.revertReason;
    let revertCode: RevertCode;
    if (appLogicResult?.reverted && teardownResult?.reverted) {
      revertCode = RevertCode.BOTH_REVERTED;
    } else if (appLogicResult?.reverted) {
      revertCode = RevertCode.APP_LOGIC_REVERTED;
    } else if (teardownResult?.reverted) {
      revertCode = RevertCode.TEARDOWN_REVERTED;
    } else {
      revertCode = RevertCode.OK;
    }

    const phaseResults = [setupResult, appLogicResult, teardownResult];
    const processedPhases = phaseResults
      .filter(res => res !== undefined)
      .map(res => publicPhaseResultToProcessedPhase(res!));
    //let phaseGasUsed: PhaseGasUsed = {
    //  [TxExecutionPhase.SETUP]: setupResult?.gasUsed || Gas.empty(),
    //  [TxExecutionPhase.APP_LOGIC]: appLogicResult?.gasUsed || Gas.empty(),
    //  [TxExecutionPhase.TEARDOWN]: teardownResult?.gasUsed || Gas.empty(),
    //};
    // Propagate only one avmProvingRequest of a function call for now, so that we know it's still provable.
    // Eventually this will be the proof for the entire public portion of the transaction.
    const avmProvingRequest =
      teardownResult?.avmProvingRequest || appLogicResult?.avmProvingRequest || setupResult?.avmProvingRequest;

    const tailKernelOutput = await this.publicKernelTailSimulator.simulate(publicKernelOutput).catch(
      // the abstract phase manager throws if simulation gives error in non-revertible phase
      async err => {
        await this.worldStateDB.rollbackToCommit();
        throw err;
      },
    );

    const transactionFee = this.getTransactionFee(tx, phaseGasUsed);
    //avmProvingRequest!.inputs.output =
    this.generateAvmCircuitPublicInputsOld(tx, tailKernelOutput, transactionFee);

    const endStateReference = await this.db.getStateReference();

    avmProvingRequest!.inputs.output = this.generateAvmCircuitPublicInputs(
      tx,
      trace.enqueuedCallTrace,
      startStateReference,
      endStateReference,
      transactionFee,
      revertCode,
      firstPublicKernelOutput,
    );

    const gasUsed = {
      totalGas: this.getActualGasUsed(tx, phaseGasUsed),
      teardownGas: phaseGasUsed[TxExecutionPhase.TEARDOWN],
    };

    return {
      avmProvingRequest: avmProvingRequest!,
      gasUsed,
      processedPhases,
      revertCode,
      revertReason,
    };
  }
  private async processSetupPhase(
    state: PhaseStateManager,
    tx: Tx,
    constants: CombinedConstantData,
    phaseGasUsed: PhaseGasUsed,
    previousPublicKernelOutput: PublicKernelCircuitPublicInputs,
  ): Promise<PublicPhaseResult | undefined> {
    const setupCallRequests = EnqueuedCallsProcessor.getCallRequestsByPhase(tx, TxExecutionPhase.SETUP);
    if (setupCallRequests.length) {
      const allocatedGas = this.getAllocatedGasForPhase(TxExecutionPhase.SETUP, tx, phaseGasUsed);
      const transactionFee = Fr.ZERO; // transaction fee unknown until teardown

      const executionRequests = EnqueuedCallsProcessor.getExecutionRequestsByPhase(tx, TxExecutionPhase.SETUP);
      const result = await this.processPhase(
        TxExecutionPhase.SETUP,
        tx,
        constants,
        setupCallRequests,
        executionRequests,
        previousPublicKernelOutput,
        allocatedGas,
        transactionFee,
        state.getActiveStateManager(),
      ).catch(async err => {
        await this.worldStateDB.rollbackToCommit();
        throw err;
      });

      return {
        avmProvingRequest: result.avmProvingRequest,
        publicKernelOutput: result.publicKernelOutput,
        returnValues: result.returnValues,
        gasUsed: result.gasUsed,
        durationMs: result.durationMs,
        reverted: result.reverted,
        revertReason: result.revertReason,
      };
    }
  }

  private async processAppLogicPhase(
    state: PhaseStateManager,
    tx: Tx,
    constants: CombinedConstantData,
    phaseGasUsed: PhaseGasUsed,
    previousPublicKernelOutput: PublicKernelCircuitPublicInputs,
  ): Promise<PublicPhaseResult | undefined> {
    const appLogicCallRequests = EnqueuedCallsProcessor.getCallRequestsByPhase(tx, TxExecutionPhase.APP_LOGIC);
    const teardownCallRequests = EnqueuedCallsProcessor.getCallRequestsByPhase(tx, TxExecutionPhase.TEARDOWN);
    if (appLogicCallRequests.length) {
      // Fork the state manager so that we can rollback state if app logic or teardown reverts.
      // Don't need to fork for setup since it's non-revertible (if setup fails, transaction is thrown out).
      state.fork();

      const allocatedGas = this.getAllocatedGasForPhase(TxExecutionPhase.APP_LOGIC, tx, phaseGasUsed);
      const transactionFee = Fr.ZERO; // transaction fee unknown until teardown

      const executionRequests = EnqueuedCallsProcessor.getExecutionRequestsByPhase(tx, TxExecutionPhase.APP_LOGIC);
      const result = await this.processPhase(
        TxExecutionPhase.SETUP,
        tx,
        constants,
        appLogicCallRequests,
        executionRequests,
        previousPublicKernelOutput,
        allocatedGas,
        transactionFee,
        state.getActiveStateManager(),
      ).catch(async err => {
        await this.worldStateDB.rollbackToCommit();
        throw err;
      });

      if (result.reverted) {
        // Drop the currently active forked state manager and rollback to end of setup.
        // Fork again for teardown so that if teardown fails we can again rollback to end of setup.
        state.discardForkedState();
      } else {
        if (!teardownCallRequests.length) {
          // Nothing to do after this (no teardown), so merge state in now instead of letting teardown handle it.
          state.mergeForkedState();
        }
      }

      return {
        avmProvingRequest: result.avmProvingRequest,
        publicKernelOutput: result.publicKernelOutput,
        returnValues: result.returnValues,
        gasUsed: result.gasUsed,
        durationMs: result.durationMs,
        reverted: result.reverted,
        revertReason: result.revertReason,
      };
    }
  }

  private async processTeardownPhase(
    state: PhaseStateManager,
    tx: Tx,
    constants: CombinedConstantData,
    phaseGasUsed: PhaseGasUsed,
    previousPublicKernelOutput: PublicKernelCircuitPublicInputs,
  ): Promise<PublicPhaseResult | undefined> {
    // there will be 0 or 1 teardown calls
    const teardownCallRequests = EnqueuedCallsProcessor.getCallRequestsByPhase(tx, TxExecutionPhase.TEARDOWN);

    if (teardownCallRequests.length) {
      if (!state.isForked()) {
        // if state isn't forked (app logic was empty or reverted), fork now
        // so we can rollback to the end of setup on teardown revert
        state.fork();
      }

      const allocatedGas = this.getAllocatedGasForPhase(TxExecutionPhase.TEARDOWN, tx, phaseGasUsed);
      const transactionFee = this.getTransactionFee(tx, phaseGasUsed);

      const executionRequests = EnqueuedCallsProcessor.getExecutionRequestsByPhase(tx, TxExecutionPhase.TEARDOWN);
      const result = await this.processPhase(
        TxExecutionPhase.SETUP,
        tx,
        constants,
        teardownCallRequests,
        executionRequests,
        previousPublicKernelOutput,
        allocatedGas,
        transactionFee,
        state.getActiveStateManager(),
      ).catch(async err => {
        await this.worldStateDB.rollbackToCommit();
        throw err;
      });

      if (result.reverted) {
        // Drop the currently active forked state manager and rollback to end of setup.
        state.discardForkedState();
      } else {
        state.mergeForkedState();
      }

      return {
        avmProvingRequest: result.avmProvingRequest,
        publicKernelOutput: result.publicKernelOutput,
        returnValues: result.returnValues,
        gasUsed: result.gasUsed,
        durationMs: result.durationMs,
        reverted: result.reverted,
        revertReason: result.revertReason,
      };
    }
  }

  private async processPhase(
    phase: TxExecutionPhase,
    tx: Tx,
    constants: CombinedConstantData,
    callRequests: PublicCallRequest[],
    executionRequests: PublicExecutionRequest[],
    previousPublicKernelOutput: PublicKernelCircuitPublicInputs,
    allocatedGas: Gas,
    transactionFee: Fr,
    txStateManager: AvmPersistableStateManager,
  ): Promise<PublicPhaseResult> {
    this.log.debug(`Beginning processing in phase ${TxExecutionPhase[phase]} for tx ${tx.getTxHash()}`);

    const phaseTimer = new Timer();
    const returnValues: NestedProcessReturnValues[] = [];
    let availableGas = allocatedGas;
    let avmProvingRequest: AvmProvingRequest;
    let publicKernelOutput = previousPublicKernelOutput;
    let reverted: boolean = false;
    let revertReason: SimulationError | undefined;
    for (let i = callRequests.length - 1; i >= 0; i--) {
      if (reverted) {
        break;
      }

      const callRequest = callRequests[i];
      const executionRequest = executionRequests[i];

      // add new contracts to the contracts db so that their functions may be found and called
      // TODO(#4073): This is catching only private deployments, when we add public ones, we'll
      // have to capture contracts emitted in that phase as well.
      // TODO(@spalladino): Should we allow emitting contracts in the fee preparation phase?
      // TODO(#6464): Should we allow emitting contracts in the private setup phase?
      // if so, this should only add contracts that were deployed during private app logic.
      await this.worldStateDB.addNewContracts(tx);

      // each enqueued call starts with an incremented side effect counter
      // FIXME: should be able to stop forking here and just trace the enqueued call (for hinting)
      // and proceed with the same state manager for the entire phase
      const enqueuedCallStateManager = txStateManager.fork(/*incrementSideEffectCounter=*/ true);
      const enqueuedCallResult = await this.enqueuedCallSimulator.simulate(
        callRequest,
        executionRequest,
        constants,
        availableGas,
        transactionFee,
        enqueuedCallStateManager,
      );

      if (enqueuedCallResult.revertReason && !PhaseIsRevertible[phase]) {
        this.log.debug(
          `Simulation error on ${executionRequest.callContext.contractAddress}:${executionRequest.callContext.functionSelector} with reason: ${enqueuedCallResult.revertReason}`,
        );
        throw enqueuedCallResult.revertReason;
      }
      if (!enqueuedCallResult.reverted) {
        txStateManager.mergeForkedState(enqueuedCallStateManager);
      } // else rollback!
      txStateManager.trace.traceEnqueuedCall(
        enqueuedCallStateManager.trace,
        callRequest,
        executionRequest.args,
        enqueuedCallResult.reverted!,
      );

      availableGas = availableGas.sub(enqueuedCallResult.gasUsed);
      avmProvingRequest = enqueuedCallResult.avmProvingRequest;
      returnValues.push(enqueuedCallResult.returnValues);
      reverted = enqueuedCallResult.reverted;
      revertReason = enqueuedCallResult.revertReason;

      // Instead of operating on worldStateDB here, do we do AvmPersistableStateManager.revert() or return()?
      if (reverted) {
        // TODO(#6464): Should we allow emitting contracts in the private setup phase?
        // if so, this is removing contracts deployed in private setup
        // You can't submit contracts in public, so this is only relevant for private-created
        // side effects
        // Are we reverting here back to end of non-revertible insertions?
        // What are we reverting back to?
        await this.worldStateDB.removeNewContracts(tx);
        tx.filterRevertedLogs(publicKernelOutput);
      } else {
        tx.unencryptedLogs.addFunctionLogs([enqueuedCallResult.newUnencryptedLogs]);
      }

      const output = await this.runMergeKernelCircuit(publicKernelOutput, enqueuedCallResult.kernelOutput);
      publicKernelOutput = output;
    }

    return {
      avmProvingRequest: avmProvingRequest!,
      publicKernelOutput,
      durationMs: phaseTimer.ms(),
      gasUsed: allocatedGas.sub(availableGas),
      returnValues,
      reverted,
      revertReason,
    };
  }

  private getAllocatedGasForPhase(phase: TxExecutionPhase, tx: Tx, phaseGasUsed: PhaseGasUsed) {
    const gasSettings = tx.data.constants.txContext.gasSettings;
    if (phase === TxExecutionPhase.TEARDOWN) {
      return gasSettings.teardownGasLimits;
    } else {
      return gasSettings.gasLimits
        .sub(tx.data.gasUsed)
        .sub(phaseGasUsed[TxExecutionPhase.SETUP])
        .sub(phaseGasUsed[TxExecutionPhase.APP_LOGIC]);
    }
  }

  private getTransactionFee(tx: Tx, phaseGasUsed: PhaseGasUsed): Fr {
    const gasFees = this.globalVariables.gasFees;
    const txFee = tx.data.gasUsed // This should've included teardown gas limits.
      .add(phaseGasUsed[TxExecutionPhase.SETUP])
      .add(phaseGasUsed[TxExecutionPhase.APP_LOGIC])
      .computeFee(gasFees);

    this.log.debug(`Computed tx fee`, { txFee, gasUsed: inspect(phaseGasUsed), gasFees: inspect(gasFees) });

    return txFee;
  }

  private getActualGasUsed(tx: Tx, phaseGasUsed: PhaseGasUsed) {
    const requireTeardown = tx.data.hasTeardownPublicCallRequest();
    const teardownGasLimits = tx.data.constants.txContext.gasSettings.teardownGasLimits;
    const privateGasUsed = tx.data.gasUsed.sub(requireTeardown ? teardownGasLimits : Gas.empty());
    const publicGasUsed = Object.values(phaseGasUsed).reduce((accum, gasUsed) => accum.add(gasUsed), Gas.empty());
    return privateGasUsed.add(publicGasUsed);
  }

  private async runMergeKernelCircuit(
    previousOutput: PublicKernelCircuitPublicInputs,
    enqueuedCallData: VMCircuitPublicInputs,
  ): Promise<PublicKernelCircuitPublicInputs> {
    const previousKernel = this.getPreviousKernelData(previousOutput);

    // The proof is not used in simulation.
    const vmProof = makeEmptyProof();
    const callData = new EnqueuedCallData(enqueuedCallData, vmProof);

    const inputs = new PublicKernelCircuitPrivateInputs(previousKernel, callData);

    return await this.publicKernelSimulator.publicKernelCircuitMerge(inputs);
  }

  private getPreviousKernelData(previousOutput: PublicKernelCircuitPublicInputs): PublicKernelData {
    // The proof is not used in simulation.
    const proof = makeEmptyRecursiveProof(NESTED_RECURSIVE_PROOF_LENGTH);

    const vk = VerificationKeyData.makeFakeHonk();
    const vkIndex = 0;
    const siblingPath = getVKSiblingPath(vkIndex);

    return new PublicKernelData(previousOutput, proof, vk, vkIndex, siblingPath);
  }

  // Temporary hack to create PublicKernelCircuitPublicInputs from PrivateKernelTailCircuitPublicInputs.
  private getPublicKernelCircuitPublicInputs(data: PrivateKernelTailCircuitPublicInputs) {
    const constants = CombinedConstantData.combine(data.constants, this.globalVariables);

    const validationRequest = PublicValidationRequests.empty();
    validationRequest.forRollup = data.rollupValidationRequests;

    const convertAccumulatedData = (from: PrivateToPublicAccumulatedData) => {
      const to = PublicAccumulatedData.empty();
      to.noteHashes.forEach((_, i) => (to.noteHashes[i].noteHash.value = from.noteHashes[i]));
      to.nullifiers.forEach((_, i) => (to.nullifiers[i].value = from.nullifiers[i]));
      to.l2ToL1Msgs.forEach((_, i) => (to.l2ToL1Msgs[i] = from.l2ToL1Msgs[i]));
      to.noteEncryptedLogsHashes.forEach((_, i) => (to.noteEncryptedLogsHashes[i] = from.noteEncryptedLogsHashes[i]));
      to.encryptedLogsHashes.forEach((_, i) => (to.encryptedLogsHashes[i] = from.encryptedLogsHashes[i]));
      to.unencryptedLogsHashes.forEach((_, i) => (to.unencryptedLogsHashes[i] = from.unencryptedLogsHashes[i]));
      to.publicCallStack.forEach((_, i) => (to.publicCallStack[i] = from.publicCallRequests[i]));
      return to;
    };

    return new PublicKernelCircuitPublicInputs(
      constants,
      validationRequest,
      convertAccumulatedData(data.forPublic!.nonRevertibleAccumulatedData),
      convertAccumulatedData(data.forPublic!.revertibleAccumulatedData),
      0,
      data.forPublic!.publicTeardownCallRequest,
      data.feePayer,
      RevertCode.OK,
    );
  }

  private generateAvmCircuitPublicInputs(
    tx: Tx,
    trace: PublicEnqueuedCallSideEffectTrace,
    startStateReference: StateReference,
    endStateReference: StateReference,
    transactionFee: Fr,
    revertCode: RevertCode,
    firstPublicKernelOutput: PublicKernelCircuitPublicInputs,
  ): AvmCircuitPublicInputs {
    const startTreeSnapshots = new TreeSnapshots(
      startStateReference.l1ToL2MessageTree,
      startStateReference.partial.noteHashTree,
      startStateReference.partial.nullifierTree,
      startStateReference.partial.publicDataTree,
    );
    const endTreeSnapshots = new TreeSnapshots(
      endStateReference.l1ToL2MessageTree,
      endStateReference.partial.noteHashTree,
      endStateReference.partial.nullifierTree,
      endStateReference.partial.publicDataTree,
    );

    const avmCircuitPublicInputs = trace.toAvmCircuitPublicInputs(
      this.globalVariables,
      startTreeSnapshots,
      tx.data.gasUsed,
      tx.data.constants.txContext.gasSettings,
      tx.data.forPublic!.nonRevertibleAccumulatedData.publicCallRequests,
      tx.data.forPublic!.revertibleAccumulatedData.publicCallRequests,
      tx.data.forPublic!.publicTeardownCallRequest,
      endTreeSnapshots,
      transactionFee,
      !revertCode.isOK(),
    );

    const getArrayLengths = (from: PrivateToPublicAccumulatedData) =>
      new PrivateToAvmAccumulatedDataArrayLengths(
        countAccumulatedItems(from.noteHashes),
        countAccumulatedItems(from.nullifiers),
        countAccumulatedItems(from.l2ToL1Msgs),
      );
    const convertAccumulatedData = (from: PrivateToPublicAccumulatedData) =>
      new PrivateToAvmAccumulatedData(from.noteHashes, from.nullifiers, from.l2ToL1Msgs);
    // Temporary overrides as these entries aren't yet populated in trace
    avmCircuitPublicInputs.previousNonRevertibleAccumulatedDataArrayLengths = getArrayLengths(
      tx.data.forPublic!.nonRevertibleAccumulatedData,
    );
    avmCircuitPublicInputs.previousRevertibleAccumulatedDataArrayLengths = getArrayLengths(
      tx.data.forPublic!.revertibleAccumulatedData,
    );
    avmCircuitPublicInputs.previousNonRevertibleAccumulatedData = convertAccumulatedData(
      tx.data.forPublic!.nonRevertibleAccumulatedData,
    );
    avmCircuitPublicInputs.previousRevertibleAccumulatedData = convertAccumulatedData(
      tx.data.forPublic!.revertibleAccumulatedData,
    );

    // merge all revertible & non-revertible side effects into output accumulated data
    const noteHashesFromPrivate = revertCode.isOK()
      ? mergeAccumulatedData(
          avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.noteHashes,
          avmCircuitPublicInputs.previousRevertibleAccumulatedData.noteHashes,
        )
      : avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.noteHashes;
    avmCircuitPublicInputs.accumulatedData.noteHashes = assertLength(
      mergeAccumulatedData(noteHashesFromPrivate, avmCircuitPublicInputs.accumulatedData.noteHashes),
      MAX_NOTE_HASHES_PER_TX,
    );
    const nullifiersFromPrivate = revertCode.isOK()
      ? mergeAccumulatedData(
          avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.nullifiers,
          avmCircuitPublicInputs.previousRevertibleAccumulatedData.nullifiers,
        )
      : avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.nullifiers;
    avmCircuitPublicInputs.accumulatedData.nullifiers = assertLength(
      mergeAccumulatedData(nullifiersFromPrivate, avmCircuitPublicInputs.accumulatedData.nullifiers),
      MAX_NULLIFIERS_PER_TX,
    );
    const msgsFromPrivate = revertCode.isOK()
      ? mergeAccumulatedData(
          avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.l2ToL1Msgs,
          avmCircuitPublicInputs.previousRevertibleAccumulatedData.l2ToL1Msgs,
        )
      : avmCircuitPublicInputs.previousNonRevertibleAccumulatedData.l2ToL1Msgs;
    avmCircuitPublicInputs.accumulatedData.l2ToL1Msgs = assertLength(
      mergeAccumulatedData(msgsFromPrivate, avmCircuitPublicInputs.accumulatedData.l2ToL1Msgs),
      MAX_L2_TO_L1_MSGS_PER_TX,
    );
    const ulogsFromPrivate = revertCode.isOK()
      ? mergeAccumulatedData(
          firstPublicKernelOutput.endNonRevertibleData.unencryptedLogsHashes,
          firstPublicKernelOutput.end.unencryptedLogsHashes,
        )
      : firstPublicKernelOutput.endNonRevertibleData.unencryptedLogsHashes;
    avmCircuitPublicInputs.accumulatedData.unencryptedLogsHashes = assertLength(
      mergeAccumulatedData(ulogsFromPrivate, avmCircuitPublicInputs.accumulatedData.unencryptedLogsHashes),
      MAX_UNENCRYPTED_LOGS_PER_TX,
    );

    const dedupedPublicDataWrites: Array<PublicDataWrite> = [];
    const leafSlotOccurences: Map<bigint, number> = new Map();
    for (const publicDataWrite of avmCircuitPublicInputs.accumulatedData.publicDataWrites) {
      this.log.debug(`Public data write: ${JSON.stringify(publicDataWrite)}`);
      const slot = publicDataWrite.leafSlot.toBigInt();
      const prevOccurrences = leafSlotOccurences.get(slot) || 0;
      leafSlotOccurences.set(slot, prevOccurrences + 1);
    }

    for (const publicDataWrite of avmCircuitPublicInputs.accumulatedData.publicDataWrites) {
      const slot = publicDataWrite.leafSlot.toBigInt();
      const prevOccurrences = leafSlotOccurences.get(slot) || 0;
      if (prevOccurrences === 1) {
        dedupedPublicDataWrites.push(publicDataWrite);
      } else {
        leafSlotOccurences.set(slot, prevOccurrences - 1);
      }
    }

    avmCircuitPublicInputs.accumulatedData.publicDataWrites = padArrayEnd(
      dedupedPublicDataWrites,
      PublicDataWrite.empty(),
      MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX,
    );

    this.log.debug(`New AVM circuit nullifiers: ${JSON.stringify(avmCircuitPublicInputs.accumulatedData.nullifiers)}`);
    this.log.debug(`New AVM circuit note hashes: ${JSON.stringify(avmCircuitPublicInputs.accumulatedData.noteHashes)}`);
    this.log.debug(
      `New AVM circuit public writes: ${JSON.stringify(avmCircuitPublicInputs.accumulatedData.publicDataWrites)}`,
    );
    this.log.debug(`New AVM: ${inspect(avmCircuitPublicInputs, { depth: 5 })}`);

    return avmCircuitPublicInputs;
  }

  // Temporary hack to create the AvmCircuitPublicInputs from public tail's public inputs.
  private generateAvmCircuitPublicInputsOld(tx: Tx, tailOutput: KernelCircuitPublicInputs, transactionFee: Fr) {
    const startTreeSnapshots = new TreeSnapshots(
      tailOutput.constants.historicalHeader.state.l1ToL2MessageTree,
      tailOutput.startState.noteHashTree,
      tailOutput.startState.nullifierTree,
      tailOutput.startState.publicDataTree,
    );

    const getArrayLengths = (from: PrivateToPublicAccumulatedData) =>
      new PrivateToAvmAccumulatedDataArrayLengths(
        countAccumulatedItems(from.noteHashes),
        countAccumulatedItems(from.nullifiers),
        countAccumulatedItems(from.l2ToL1Msgs),
      );

    const convertAccumulatedData = (from: PrivateToPublicAccumulatedData) =>
      new PrivateToAvmAccumulatedData(from.noteHashes, from.nullifiers, from.l2ToL1Msgs);

    const convertAvmAccumulatedData = (from: CombinedAccumulatedData) =>
      new AvmAccumulatedData(
        from.noteHashes,
        from.nullifiers,
        from.l2ToL1Msgs,
        from.unencryptedLogsHashes,
        from.publicDataWrites,
      );

    // This is wrong. But this is not used or checked in the rollup at the moment.
    // Should fetch the updated roots from db.
    const endTreeSnapshots = startTreeSnapshots;

    const old = new AvmCircuitPublicInputs(
      tailOutput.constants.globalVariables,
      startTreeSnapshots,
      tx.data.gasUsed,
      tx.data.constants.txContext.gasSettings,
      tx.data.forPublic!.nonRevertibleAccumulatedData.publicCallRequests,
      tx.data.forPublic!.revertibleAccumulatedData.publicCallRequests,
      tx.data.forPublic!.publicTeardownCallRequest,
      getArrayLengths(tx.data.forPublic!.nonRevertibleAccumulatedData),
      getArrayLengths(tx.data.forPublic!.revertibleAccumulatedData),
      convertAccumulatedData(tx.data.forPublic!.nonRevertibleAccumulatedData),
      convertAccumulatedData(tx.data.forPublic!.revertibleAccumulatedData),
      endTreeSnapshots,
      convertAvmAccumulatedData(tailOutput.end),
      transactionFee,
      !tailOutput.revertCode.equals(RevertCode.OK),
    );

    this.log.debug(`Old AVM circuit nullifiers: ${JSON.stringify(old.accumulatedData.nullifiers)}`);
    this.log.debug(`Old AVM circuit note hashes: ${JSON.stringify(old.accumulatedData.noteHashes)}`);
    this.log.debug(`Old AVM circuit public writes: ${JSON.stringify(old.accumulatedData.publicDataWrites)}`);

    this.log.debug(`Old AVM: ${inspect(old, { depth: 5 })}`);

    return old;
  }
}

class PhaseStateManager {
  private currentlyActiveStateManager: AvmPersistableStateManager | undefined;

  constructor(private readonly txStateManager: AvmPersistableStateManager) {}

  fork() {
    assert(!this.currentlyActiveStateManager, 'Cannot fork when already forked');
    this.currentlyActiveStateManager = this.txStateManager.fork();
  }

  getTxStateManager() {
    return this.txStateManager;
  }

  getActiveStateManager() {
    return this.currentlyActiveStateManager || this.txStateManager;
  }

  isForked() {
    return !!this.currentlyActiveStateManager;
  }

  mergeForkedState() {
    assert(this.currentlyActiveStateManager, 'No forked state to merge');
    this.txStateManager.mergeForkedState(this.currentlyActiveStateManager!);

    this.txStateManager.trace.traceExecutionPhase(
      this.currentlyActiveStateManager!.trace,
      [],
      [], //executionRequests.map(req => req.args),
      /*reverted=*/ false,
    );

    // Drop the forked state manager now that it is merged
    this.currentlyActiveStateManager = undefined;
  }

  discardForkedState() {
    assert(this.currentlyActiveStateManager, 'No forked state to discard');

    this.txStateManager.trace.traceExecutionPhase(
      this.currentlyActiveStateManager!.trace,
      [],
      [], //executionRequests.map(req => req.args),
      /*reverted=*/ true,
    );

    // Drop the forked state manager. We don't want it!
    this.currentlyActiveStateManager = undefined;
  }
}

function publicPhaseResultToProcessedPhase(result: PublicPhaseResult): ProcessedPhase {
  return {
    phase: TxExecutionPhase.SETUP,
    durationMs: result.durationMs,
    returnValues: result.returnValues,
    reverted: result.reverted,
    revertReason: result.revertReason,
  };
}
