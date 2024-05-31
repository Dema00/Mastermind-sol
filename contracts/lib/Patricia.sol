// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

error NodeNotFound();


/**
 * @title Functions to retrieve and append nodes to a binary Patricia Trie 
 * 
 * Nodes are 8 bytes long subdivied as such:
 *      [++++----][++++----][++++----][++++----][++++----][++++][----++++][----][++++][----]
 *      └────────────────────────────┘└────────┘└──────────────┘└──────────────┘└────┘└────┘
 *                  Node address        Padding     Child0 addr     Child1 addr   CC    NC     
 */
library Tree {

    function retrieve(Turn storage _turn, bytes8 key, uint8 guess_len ) 
    internal view returns (bytes1 cc_nc){
        bytes8 node = _turn.nodes[_turn.root_node];
        uint8 key_explored;

        // If the tree has no more nodes stop
        while (
            (bytes2(node >> 32) & bytes2(0xfff0) != 0) ||
            (bytes2(node >> 44) & bytes2(0xfff0) != 0)
        ) {
            uint8 padding = uint8(bytes1(node >> 24));
            bytes3 mask = bytes3(uint24(1) << padding -1);
            key_explored += padding;
            if (bytes3(node) ^ mask == 0x0) {
                node = _turn.nodes[bytes2(
                    node >> (32 + 12 * uint8(bytes1(
                        (node >> (key_explored-7)) & bytes1(uint8(0x1))
                    )))
                ) & bytes2(0xfff0)];
            }
        }

        if (node != 0) {
            return bytes1(node >> 56);
        } else {
            revert NodeNotFound();
        }
    }
}


// ([3] [1] [1.5] [1.5] [1] + [2]) * 32*3
//     01001
//  

// 01001 01011010 1010101010100111100110
//       1 1  1 1
// [8] [8] [8] [8]