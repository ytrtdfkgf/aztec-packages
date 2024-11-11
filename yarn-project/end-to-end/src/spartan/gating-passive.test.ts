import { EthCheatCodes, sleep } from '@aztec/aztec.js';
import { createDebugLogger } from '@aztec/foundation/log';

import { expect, jest } from '@jest/globals';

import { RollupCheatCodes } from '../../../aztec.js/src/utils/cheat_codes.js';
import { type TestWallets, setupTestWalletsWithTokens } from './setup_test_wallets.js';
import { applyNetworkShaping, awaitL2BlockNumber, getConfig, isK8sConfig, startPortForward } from './utils.js';

const config = getConfig(process.env);
if (!isK8sConfig(config)) {
  throw new Error('This test must be run in a k8s environment');
}
const { NAMESPACE, HOST_PXE_PORT, HOST_ETHEREUM_PORT, CONTAINER_PXE_PORT, CONTAINER_ETHEREUM_PORT, SPARTAN_DIR } =
  config;
const debugLogger = createDebugLogger('aztec:spartan-test:reorg');

describe('a test that passively observes the network in the presence of node failures and network shaping', () => {
  jest.setTimeout(60 * 60 * 1000); // 60 minutes

  const MINT_AMOUNT = 2_000_000n;
  const ETHEREUM_HOST = `http://127.0.0.1:${HOST_ETHEREUM_PORT}`;
  const PXE_URL = `http://127.0.0.1:${HOST_PXE_PORT}`;

  let testWallets: TestWallets;

  it('survives a reorg', async () => {
    await startPortForward({
      resource: 'svc/spartan-aztec-network-pxe',
      namespace: NAMESPACE,
      containerPort: CONTAINER_PXE_PORT,
      hostPort: HOST_PXE_PORT,
    });
    await startPortForward({
      resource: 'svc/spartan-aztec-network-ethereum',
      namespace: NAMESPACE,
      containerPort: CONTAINER_ETHEREUM_PORT,
      hostPort: HOST_ETHEREUM_PORT,
    });
    testWallets = await setupTestWalletsWithTokens(PXE_URL, MINT_AMOUNT, debugLogger);
    const ethCheatCodes = new EthCheatCodes(ETHEREUM_HOST);
    const rollupCheatCodes = new RollupCheatCodes(
      ethCheatCodes,
      await testWallets.pxe.getNodeInfo().then(n => n.l1ContractAddresses),
    );
    const { epochDuration, slotDuration } = await rollupCheatCodes.getConfig();

    // we'll use these to check that the chain made progress
    // and see how many slots were missed

    // wait for the chain to build at least 1 epoch's worth of blocks
    // note, don't forget that normally an epoch doesn't need epochDuration worth of blocks,
    // but here we do double duty:
    // we want a handful of blocks, and we want to pass the epoch boundary
    await awaitL2BlockNumber(rollupCheatCodes, epochDuration, 60 * 5);

    // kill the provers
    const stdout = await applyNetworkShaping({
      valuesFile: 'moderate.yaml',
      namespace: NAMESPACE,
      spartanDir: SPARTAN_DIR,
    });
    debugLogger.info(stdout);

    for (let i = 0; i < 3; i++) {
      debugLogger.info(`Waiting for 1 epoch to pass`);
      const controlTips = await rollupCheatCodes.getTips();
      await sleep(Number(epochDuration * slotDuration) * 1000);
      const newTips = await rollupCheatCodes.getTips();

      // if we advanced 3 epochs, we should have built at least 90% of the epoch's worth of slots
      const expectedPending = controlTips.pending + BigInt(0.9 * Number(epochDuration));
      expect(newTips.pending).toBeGreaterThan(expectedPending);
    }
  });
});
