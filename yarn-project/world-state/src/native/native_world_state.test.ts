import { MerkleTreeId } from '@aztec/circuit-types';

import { jest } from '@jest/globals';
import { decode, encode } from 'msgpackr';

import {
  MessageHeader,
  type NativeInstance,
  TypedMessage,
  WorldStateMessageType,
  worldStateRevision,
} from './message.js';
import { NativeWorldStateService } from './native_world_state.js';

describe('NativeWorldState', () => {
  let process: jest.MockedFunction<NativeInstance['call']>;
  let worldState: WorldStateWithMockedInstance;

  beforeEach(() => {
    process = jest.fn();
    worldState = new WorldStateWithMockedInstance({ call: process });
  });

  it('encodes messages', async () => {
    process.mockImplementationOnce(encodedMsg => {
      const msg: TypedMessage<any, any> = decode(encodedMsg);
      expect(msg.msgType).toBe(WorldStateMessageType.GET_TREE_INFO);

      expect(msg.value.treeId).toEqual(MerkleTreeId.NULLIFIER_TREE);
      expect(msg.value.revision).toEqual(worldStateRevision(false));

      return Promise.resolve(
        encode(
          new TypedMessage(
            WorldStateMessageType.GET_TREE_INFO,
            new MessageHeader({ requestId: msg.header.messageId }),
            {
              root: 0x42,
              size: 0,
            },
          ),
        ),
      );
    });

    await worldState.getTreeInfo(MerkleTreeId.NULLIFIER_TREE, false);
  });
});

class WorldStateWithMockedInstance extends NativeWorldStateService {
  constructor(instance: NativeInstance) {
    super(instance);
  }
}
