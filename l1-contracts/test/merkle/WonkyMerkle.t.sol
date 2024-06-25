// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
pragma solidity >=0.8.18;

import {Test} from "forge-std/Test.sol";
import {Hash} from "../../src/core/libraries/Hash.sol";

import {TxsDecoderHelper} from "../decoders/helpers/TxsDecoderHelper.sol";
/**
 * Tests the tree construction for wonky rollups.
 * Used for calculating txsEffectsHash over non balanced rollups - each leaf is one baseLeaf
 * calculated in TxsDecoder.sol.
 * The encoding for branch structure is given in the logs section of the protocol.
 * See noir-projects/noir-protocol-circuits/crates/types/src/merkle_tree/variable_merkle_tree.nr
 * for similar tests.
 */

contract WonkyMerkleTest is Test {
  /**
   * The protocol has a better guide on the encoding, but for info:
   * Each 'branch' starting from the leftmost one has 2 bytes in treedata:
   * numBranches: depth of leftmost leaf's parent in relation to target node (target node starts as the root)
   * numLeavesInBranch: number of leaves in leftmost branch, either 1 or 2
   * Example - 5 txs (see tests)
   *
   *               root
   *          /            \
   *       merge2       ^merge3
   *     /        \      /    \
   *  merge1   ^base3  base4  base5
   *  /     \
   * base1  base2
   *
   * Starting from the left, our branch has:
   * 2 leaves: (base1, base2) -> merge1 -> has depth 2
   * => our first 2 bytes are 0202
   * Since we have depth 2, we need two more branches to find the siblings (targets) to hash with (marked with ^ above):
   *  base3: 1 leaf (base3) -> base3 -> no more hashing required to reach target, depth = 0
   *         => next 2 bytes are 0001
   *  merge3: 2 leaves (base4 and 5) -> merge3 -> no more hashing to reach target, depth = 0
   *         => next 2 bytes are 0002
   * => Full tree info is 020200010002
   *
   * Example - 6 txs:
   *
   *                    root
   *               /            \
   *           merge4          ^base6
   *        /          \
   *     merge1      ^merge3
   *    /     \      /     \
   * base1  base2  base3   merge2
   *                       /   \
   *                    base4  base5
   *
   * Leftmost branch is the same as above => first 2 bytes are 0202
   * Next sibling to hash with (marked with ^) is our 'target':
   *  merge3: 1 leaf (base3) -> base3 -> we need one more layer to find merge3, depth = 1
   *         => next 2 bytes are 0101
   *         Since we have depth 1, we need one branch to find the value of merge2:
   *         merge2: 2 leaves (base 4 and 5) -> merge2 -> no more hashing required to reach merge2, depth = 0
   *                => next 2 bytes are 0002
   *  base6: 1 leaf (base6) -> base6 -> no more hashing needed to reach root, depth = 0
   *         => next 2 bytes are 0001
   * => Full tree info is 0202010100020001
   */
  TxsDecoderHelper internal txsHelper;

  function setUp() public {
    txsHelper = new TxsDecoderHelper();
  }

  // Example - 2 txs:
  //
  //   root
  //  /     \
  // base  base
  function testComputeTxsEffectsHash2() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](2);
    for (uint256 i = 0; i < 2; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // We have just one 'balanced' branch, so depth is 0 with 2 elements
    bytes memory treeData = hex"0002";
    bytes32 rootTxsEffectsHash = Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 3 txs:
  //
  //        root
  //     /        \
  //   merge     base
  //  /     \
  // base  base
  function testComputeTxsEffectsHash3() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](3);
    for (uint256 i = 0; i < 3; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 1 and 2 elements
    // The next branch has depth 0 and 1 element
    bytes memory treeData = hex"01020001";
    bytes32 mergeTxsEffectsHash = Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(mergeTxsEffectsHash, baseLeaves[2]));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 5 txs (combining above 2 trees):
  //
  //               root
  //          /            \
  //        merge        merge
  //     /        \      /    \
  //   merge     base  base  base
  //  /     \
  // base  base
  // NB: In practice we wouldn't create the structure above as it's likely more efficient to
  // make the tree taller rather than wider, but useful for testing (see next test for realistic structure)
  function testComputeTxsEffectsHash5Wide() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](5);
    for (uint256 i = 0; i < 5; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 2 and 2 elements
    //  The next branch has depth 0 before it must be hashed and 1 element
    //  The next branch has depth 0 before it must be hashed and 2 elements
    bytes memory treeData = hex"020200010002";
    bytes32 firstMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 secondMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(firstMergeTxsEffectsHash, baseLeaves[2]));
    bytes32 thirdMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[3], baseLeaves[4]));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(secondMergeTxsEffectsHash, thirdMergeTxsEffectsHash));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 5 txs:
  //
  //                  root
  //             /            \
  //          merge           base
  //      /          \
  //   merge        merge
  //  /     \      /     \
  // base  base  base   base
  function testComputeTxsEffectsHash5Tall() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](5);
    for (uint256 i = 0; i < 5; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 2 and 2 elements
    //  The next branch has depth 0 before it must be hashed w/ the leftmost branch and 2 elements
    //  The next branch has depth 0 and 1 elements
    bytes memory treeData = hex"020200020001";
    bytes32 firstMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 secondMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[2], baseLeaves[3]));
    bytes32 thirdMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(firstMergeTxsEffectsHash, secondMergeTxsEffectsHash));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(thirdMergeTxsEffectsHash, baseLeaves[4]));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 6 txs:
  //
  //                  root
  //             /            \
  //         merge4           base
  //      /          \
  //   merge1       merge3
  //  /     \      /     \
  // base  base  base   merge2
  //                    /   \
  //                  base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  function testComputeTxsEffectsHash6() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](6);
    for (uint256 i = 0; i < 6; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 2 and 2 elements (->merge1)
    //  The next branch has depth 1 before target (merge3) and 1 element
    //    The next branch has depth 0 before target (merge2) and 2 elements (->merge2)
    //  The next branch has depth 0 and 1 element (sibling of merge4 -> root)
    bytes memory treeData = hex"0202010100020001";
    bytes32 firstMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 secondMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[3], baseLeaves[4]));
    bytes32 thirdMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[2], secondMergeTxsEffectsHash));
    bytes32 fourthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(firstMergeTxsEffectsHash, thirdMergeTxsEffectsHash));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(fourthMergeTxsEffectsHash, baseLeaves[5]));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 8 txs:
  //
  //                  root
  //             /            \
  //          merge5          merge6
  //      /          \        /    \
  //   merge1       merge4  base  base
  //  /     \      /     \
  // base  base  base   merge3
  //                    /   \
  //                 merge2  base
  //                 /  \
  //              base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  function testComputeTxsEffectsHash8() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](8);
    for (uint256 i = 0; i < 8; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 2 and 2 elements (->merge1)
    //  The next branch has depth 1 before target (merge4) and 1 element
    //    The next branch has depth 1 before target (merge3) and 2 elements (->merge2)
    //      The next branch has depth 0 before target (merge3) and 1 element (->merge3)
    //  The next branch has depth 0 before target (merge6) and 2 elements (->merge6)
    bytes memory treeData = hex"02020101010200010002";
    bytes32 firstMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 secondMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[3], baseLeaves[4]));
    bytes32 thirdMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(secondMergeTxsEffectsHash, baseLeaves[5]));
    bytes32 fourthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[2], thirdMergeTxsEffectsHash));
    bytes32 fifthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(firstMergeTxsEffectsHash, fourthMergeTxsEffectsHash));
    bytes32 sixthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[6], baseLeaves[7]));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(fifthMergeTxsEffectsHash, sixthMergeTxsEffectsHash));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }

  // Example - 10 txs:
  //
  //                          root
  //             /                          \
  //          merge5                        merge8
  //      /          \                      /    \
  //   merge1       merge4               merge7 base
  //  /     \      /     \              /   \
  // base  base  base   merge3       merge6 base
  //                    /   \       /     \
  //                 merge2  base  base  base
  //                 /  \
  //              base  base
  // NB: Again, not a realistic structure, just to test the wonky tree logic
  function testComputeTxsEffectsHash10() public {
    // Generate some base leaves
    bytes32[] memory baseLeaves = new bytes32[](10);
    for (uint256 i = 0; i < 10; i++) {
      baseLeaves[i] = Hash.sha256ToField(abi.encodePacked(i));
    }
    // From L to R, the first 'branch' has depth 2 and 2 elements (->merge1)
    //  The next branch has depth 1 before target (merge4) and 1 element
    //    The next branch has depth 1 before target (merge3) and 2 elements (->merge2)
    //      The next branch has depth 0 before target (sibling of merge2) and 1 element (->merge3)
    //  The next branch has depth 2 before target (merge8) and 2 elements (->merge6)
    //    The next branch has depth 0 before target (sibling of merge6) and 1 element (->merge7)
    //    The next branch has depth 0 before target (sibling of merge7) and 1 element (->merge8)
    bytes memory treeData = hex"0202010101020001020200010001";
    // Subtree w root merge5:
    bytes32 firstMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[0], baseLeaves[1]));
    bytes32 secondMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[3], baseLeaves[4]));
    bytes32 thirdMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(secondMergeTxsEffectsHash, baseLeaves[5]));
    bytes32 fourthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[2], thirdMergeTxsEffectsHash));
    bytes32 fifthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(firstMergeTxsEffectsHash, fourthMergeTxsEffectsHash));
    // Subtree w root merge8:
    bytes32 sixthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(baseLeaves[6], baseLeaves[7]));
    bytes32 seventhMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(sixthMergeTxsEffectsHash, baseLeaves[8]));
    bytes32 eighthMergeTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(seventhMergeTxsEffectsHash, baseLeaves[9]));
    bytes32 rootTxsEffectsHash =
      Hash.sha256ToField(bytes.concat(fifthMergeTxsEffectsHash, eighthMergeTxsEffectsHash));
    (bytes32 calculatedTxsEffectsHash, uint256 leafOffset) =
      txsHelper.computeWonkyRoot(0, baseLeaves, treeData);
    assertEq(calculatedTxsEffectsHash, rootTxsEffectsHash);
    assertEq(leafOffset, baseLeaves.length);
  }
}
