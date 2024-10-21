import type { ProofInputs, ProofInputsUri, ProofRequestId, ProofType } from './proof_request.js';

export interface ProofInputsService {
  saveProofInputs<T extends ProofType>(inputs: ProofInputs[T]): Promise<ProofInputsUri>;

  getProofInputs<T extends ProofType>(proofType: T, reference: ProofInputsUri): Promise<ProofInputs[T]>;
}

const PREFIX = 'data:application/octet-stream;base64';
export class DataUriProofInputs implements ProofInputsService {
  saveProofInputs<T extends ProofType>(inputs: ProofInputs[T]): Promise<ProofInputsUri> {
    const data = inputs.toBuffer().toString('base64url');
    return Promise.resolve(`${PREFIX},${data}` as ProofInputsUri);
  }

  getProofInputs<T extends ProofType>(type: T, reference: ProofInputsUri): Promise<ProofInputs[T]> {
    if (!reference.startsWith(PREFIX)) {
      return Promise.reject(new Error('Invalid reference'));
    }

    const [_, data] = reference.split(',');
    const buf = Buffer.from(data, 'base64url');
  }
}
