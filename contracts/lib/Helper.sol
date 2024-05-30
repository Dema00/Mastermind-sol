// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

library MastermindHelper {
    
    /**
     * @dev Terrible and ugly function to pop the first element of an array
     */
    function pop_first(bytes32[] storage arr) internal {
        require(arr.length > 0, "Array is empty");

        // Shift elements to the left
        for (uint i = 1; i < arr.length; i++) {
            arr[i - 1] = arr[i];
        }

        // Remove the last element (which is now duplicated)
        arr.pop();
    }

    /**
     * @dev Generates the UUID of a new game using the sender's address and the
     *      block timestamp.
     */
    function create_game_uuid() internal view returns(bytes32) {
        return keccak256(abi.encodePacked(block.timestamp,msg.sender));
    }

    function validateSenderIdentity(Game storage _game) internal view {
        // Check identity
        require(_game.opponent == msg.sender
            || _game.creator == msg.sender,
            "Sender not part of game"
        );
    }
}
