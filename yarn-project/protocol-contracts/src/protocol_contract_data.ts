// GENERATED FILE - DO NOT EDIT. RUN `yarn generate` or `yarn generate:data`
import { AztecAddress, Fr } from '@aztec/circuits.js';
import { type ContractArtifact } from '@aztec/foundation/abi';
import { loadContractArtifact } from '@aztec/types/abi';
import { type NoirCompiledContract } from '@aztec/types/noir';

import AuthRegistryJson from '../artifacts/AuthRegistry.json' assert { type: 'json' };
import ContractClassRegistererJson from '../artifacts/ContractClassRegisterer.json' assert { type: 'json' };
import ContractInstanceDeployerJson from '../artifacts/ContractInstanceDeployer.json' assert { type: 'json' };
import FeeJuiceJson from '../artifacts/FeeJuice.json' assert { type: 'json' };
import MultiCallEntrypointJson from '../artifacts/MultiCallEntrypoint.json' assert { type: 'json' };
import RouterJson from '../artifacts/Router.json' assert { type: 'json' };

export const protocolContractNames = [
  'AuthRegistry',
  'ContractInstanceDeployer',
  'ContractClassRegisterer',
  'MultiCallEntrypoint',
  'FeeJuice',
  'Router',
] as const;

export type ProtocolContractName = (typeof protocolContractNames)[number];

export const ProtocolContractArtifact: Record<ProtocolContractName, ContractArtifact> = {
  AuthRegistry: loadContractArtifact(AuthRegistryJson as NoirCompiledContract),
  ContractInstanceDeployer: loadContractArtifact(ContractInstanceDeployerJson as NoirCompiledContract),
  ContractClassRegisterer: loadContractArtifact(ContractClassRegistererJson as NoirCompiledContract),
  MultiCallEntrypoint: loadContractArtifact(MultiCallEntrypointJson as NoirCompiledContract),
  FeeJuice: loadContractArtifact(FeeJuiceJson as NoirCompiledContract),
  Router: loadContractArtifact(RouterJson as NoirCompiledContract),
};

export const ProtocolContractSalt: Record<ProtocolContractName, Fr> = {
  AuthRegistry: new Fr(1),
  ContractInstanceDeployer: new Fr(1),
  ContractClassRegisterer: new Fr(1),
  MultiCallEntrypoint: new Fr(1),
  FeeJuice: new Fr(1),
  Router: new Fr(1),
};

export const ProtocolContractAddress: Record<ProtocolContractName, AztecAddress> = {
  AuthRegistry: AztecAddress.fromBigInt(1n),
  ContractInstanceDeployer: AztecAddress.fromBigInt(2n),
  ContractClassRegisterer: AztecAddress.fromBigInt(3n),
  MultiCallEntrypoint: AztecAddress.fromBigInt(4n),
  FeeJuice: AztecAddress.fromBigInt(5n),
  Router: AztecAddress.fromBigInt(6n),
};

export const ProtocolContractLeaf = {
  AuthRegistry: Fr.fromString('0x09172ebaf074e2dfd6042c5bec17ce758bf331875be9854cda1409efba37e714'),
  ContractInstanceDeployer: Fr.fromString('0x2fdb4dafd5e20dd116e2073a3a016b5b51dc33a903556043d77c0897fcbbc5ab'),
  ContractClassRegisterer: Fr.fromString('0x25d9a3e138b7157c4aa3f33eae02aa5db61569024b72713fae656d95d61cb020'),
  MultiCallEntrypoint: Fr.fromString('0x25b15f0024b95e89a4d1dcbb2d31057b7eaac80950bd6cda9c21216f15e387b9'),
  FeeJuice: Fr.fromString('0x16a1808756ae45a40096b4082da9a4bba7c88c1f62a1b31ad07e506c8b5ab04d'),
  Router: Fr.fromString('0x23241fc5b200af6939992e4d55dfc0dcb072380c33b475ae5eba271fa2d40af8'),
};

export const protocolContractTreeRoot = Fr.fromString(
  '0x292e435fb68f0f7425710bdcd98828f7509087eaca13fe2631bb35e7b1f7879b',
);
