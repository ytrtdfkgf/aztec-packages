import {
  type AztecNode,
  L2BlockStream,
  type L2BlockStreamEvent,
  type L2BlockStreamEventHandler,
} from '@aztec/circuit-types';
import { INITIAL_L2_BLOCK_NUM } from '@aztec/circuits.js';
import { type DebugLogger, createDebugLogger } from '@aztec/foundation/log';
import { type L2TipsStore } from '@aztec/kv-store/stores';

import { type PxeDatabase } from '../database/index.js';

/**
 * The Synchronizer class manages the synchronization of note processors and interacts with the Aztec node
 * to obtain encrypted logs, blocks, and other necessary information for the accounts.
 * It provides methods to start or stop the synchronization process, add new accounts, retrieve account
 * details, and fetch transactions by hash. The Synchronizer ensures that it maintains the note processors
 * in sync with the blockchain while handling retries and errors gracefully.
 */
export class Synchronizer implements L2BlockStreamEventHandler {
  private running = false;
  private initialSyncBlockNumber = INITIAL_L2_BLOCK_NUM - 1;
  private log: DebugLogger;
  private blockStream: L2BlockStream;

  constructor(private node: AztecNode, private db: PxeDatabase, private l2TipsStore: L2TipsStore, logSuffix = '') {
    this.log = createDebugLogger(logSuffix ? `aztec:pxe_synchronizer_${logSuffix}` : 'aztec:pxe_synchronizer');
    this.blockStream = new L2BlockStream(node, this.l2TipsStore, this);
  }

  /** Handle events emitted by the block stream. */
  async handleBlockStreamEvent(event: L2BlockStreamEvent): Promise<void> {
    await this.l2TipsStore.handleBlockStreamEvent(event);

    switch (event.type) {
      case 'blocks-added':
        await this.db.setHeader(event.blocks.at(-1)!.header);
        break;
      case 'chain-pruned':
        await this.db.unnullifyNotesAfter(event.blockNumber);
        await this.db.removeNotesAfter(event.blockNumber);
        break;
    }
  }

  /**
   * Starts the synchronization process by fetching encrypted logs and blocks from a specified position.
   * Continuously processes the fetched data for all note processors until stopped. If there is no data
   * available, it retries after a specified interval.
   *
   * @param limit - The maximum number of encrypted, unencrypted logs and blocks to fetch in each iteration.
   * @param retryInterval - The time interval (in ms) to wait before retrying if no data is available.
   */
  public async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.blockStream.sync();
    this.log.info('Initial sync complete');
    this.blockStream.start();
    this.log.debug('Started loop');
  }

  /**
   * Stops the synchronizer gracefully, interrupting any ongoing sleep and waiting for the current
   * iteration to complete before setting the running state to false. Once stopped, the synchronizer
   * will no longer process blocks or encrypted logs and must be restarted using the start method.
   *
   * @returns A promise that resolves when the synchronizer has successfully stopped.
   */
  public async stop() {
    this.running = false;
    await this.blockStream.stop();
    this.log.info('Stopped');
  }

  private getSynchedBlockNumber() {
    return this.db.getBlockNumber() ?? this.initialSyncBlockNumber;
  }

  /**
   * Checks whether all the blocks were processed (tree roots updated, txs updated with block info, etc.).
   * @returns True if there are no outstanding blocks to be synched.
   * @remarks This indicates that blocks and transactions are synched even if notes are not.
   * @remarks Compares local block number with the block number from aztec node.
   */
  public async isGlobalStateSynchronized() {
    const latest = await this.node.getBlockNumber();
    return latest <= this.getSynchedBlockNumber();
  }

  /**
   * Returns the latest block that has been synchronized by the synchronizer and each account.
   * @returns The latest block synchronized for blocks, and the latest block synched for notes for each public key being tracked.
   */
  public getSyncStatus() {
    const lastBlockNumber = this.getSynchedBlockNumber();
    return {
      blocks: lastBlockNumber,
    };
  }
}
