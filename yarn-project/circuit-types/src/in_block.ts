import { schemas } from '@aztec/foundation/schemas';

import { type ZodTypeAny, z } from 'zod';

import { type L2Block } from './l2_block.js';

export type InBlock<T> = {
  l2BlockNumber: number;
  l2BlockHash: string;
  data: T;
};

export function wrapInBlock<T>(data: T, block: L2Block): InBlock<T> {
  return {
    data,
    l2BlockNumber: block.number,
    l2BlockHash: block.hash().toString(),
  };
}

export function inBlockSchemaFor<T extends ZodTypeAny>(schema: T) {
  return z.object({
    data: schema,
    l2BlockNumber: schemas.Integer,
    l2BlockHash: z.string(),
  });
}
