import { type ContractArtifact } from '@aztec/foundation/abi';

import { getTestContractArtifact } from '../tests/fixtures.js';
import { computeArtifactHash } from './artifact_hash.js';

describe('ArtifactHash', () => {
  it('calculates the artifact hash', () => {
    const emptyArtifact: ContractArtifact = {
      fileMap: [],
      functions: [],
      name: 'Test',
      outputs: {
        globals: {},
        structs: {},
      },
      storageLayout: {},
      notes: {},
    };
    expect(computeArtifactHash(emptyArtifact).toString()).toMatchInlineSnapshot(
      `"0x0c6fd9b48570721c5d36f978d084d77cacbfd2814f1344985f40e62bea6e61be"`,
    );
  });

  it('calculates the test contract artifact hash multiple times to ensure deterministic hashing', () => {
    const testArtifact = getTestContractArtifact();

    for (let i = 0; i < 1000; i++) {
      expect(computeArtifactHash(testArtifact).toString()).toMatchInlineSnapshot(
        `"0x193c8f0e49d2a1b865f8afec829f3cf0bc136232ce7d09f823192dcc3e876df2"`,
      );
    }
  });
});
