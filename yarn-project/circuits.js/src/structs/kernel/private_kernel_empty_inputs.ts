import { Fr } from '@aztec/foundation/fields';
import { hexSchemaFor } from '@aztec/foundation/schemas';
import { BufferReader, serializeToBuffer } from '@aztec/foundation/serialize';
import { type FieldsOf } from '@aztec/foundation/types';

import { type RECURSIVE_PROOF_LENGTH } from '../../constants.gen.js';
import { Header } from '../header.js';
import { type RecursiveProof } from '../recursive_proof.js';
import { type VerificationKeyAsFields } from '../verification_key.js';

export class PrivateKernelEmptyInputData {
  constructor(
    public readonly header: Header,
    public readonly chainId: Fr,
    public readonly version: Fr,
    public readonly vkTreeRoot: Fr,
    public readonly protocolContractTreeRoot: Fr,
  ) {}

  toBuffer(): Buffer {
    return serializeToBuffer(this.header, this.chainId, this.version, this.vkTreeRoot, this.protocolContractTreeRoot);
  }

  toString(): string {
    return this.toBuffer().toString('hex');
  }

  static fromBuffer(buf: Buffer) {
    const reader = BufferReader.asReader(buf);
    return new PrivateKernelEmptyInputData(
      reader.readObject(Header),
      reader.readObject(Fr),
      reader.readObject(Fr),
      reader.readObject(Fr),
      reader.readObject(Fr),
    );
  }

  static fromString(str: string): PrivateKernelEmptyInputData {
    return PrivateKernelEmptyInputData.fromBuffer(Buffer.from(str, 'hex'));
  }

  static from(fields: FieldsOf<PrivateKernelEmptyInputData>) {
    return new PrivateKernelEmptyInputData(
      fields.header,
      fields.chainId,
      fields.version,
      fields.vkTreeRoot,
      fields.protocolContractTreeRoot,
    );
  }

  /** Returns a hex representation for JSON serialization. */
  toJSON() {
    return this.toString();
  }

  /** Creates an instance from a hex string. */
  static get schema() {
    return hexSchemaFor(PrivateKernelEmptyInputData);
  }
}

export class PrivateKernelEmptyInputs {
  constructor(
    public readonly emptyNested: EmptyNestedData,
    public readonly header: Header,
    public readonly chainId: Fr,
    public readonly version: Fr,
    public readonly vkTreeRoot: Fr,
    public readonly protocolContractTreeRoot: Fr,
  ) {}

  toBuffer(): Buffer {
    return serializeToBuffer(
      this.emptyNested,
      this.header,
      this.chainId,
      this.version,
      this.vkTreeRoot,
      this.protocolContractTreeRoot,
    );
  }

  static from(fields: FieldsOf<PrivateKernelEmptyInputs>) {
    return new PrivateKernelEmptyInputs(
      fields.emptyNested,
      fields.header,
      fields.chainId,
      fields.version,
      fields.vkTreeRoot,
      fields.protocolContractTreeRoot,
    );
  }
}

export class EmptyNestedCircuitInputs {
  toBuffer(): Buffer {
    return Buffer.alloc(0);
  }
}

export class EmptyNestedData {
  constructor(
    public readonly proof: RecursiveProof<typeof RECURSIVE_PROOF_LENGTH>,
    public readonly vk: VerificationKeyAsFields,
  ) {}

  toBuffer(): Buffer {
    return serializeToBuffer(this.proof, this.vk);
  }
}
