// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";
import "./Game.sol";

library Helper {
    
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

    function senderIsPartOfGame(Game storage _game) internal view {
        // Check identity
        require(_game.opponent == msg.sender
            || _game.creator == msg.sender,
            "Sender not part of game"
        );
    }

    function senderIsMaker(Game storage _game) internal view {
        //Check sender identity
        require(
            GameFunction.getCurrBreaker(_game, false) == msg.sender,
            "Message sender is not the codemaker"
        );
    }

    function senderIsBreaker(Game storage _game) internal view {
        //Check sender identity
        require(
            GameFunction.getCurrBreaker(_game, true) == msg.sender,
            "Message sender is not the codebreaker"
        );
    }

    function senderIsNotAFK(Game storage _game) internal view {
        require(
            _game.afk_timer[msg.sender] < block.timestamp,
            "You were AFK for too long"
        );
    }

    function accuseAFK(Game storage _game, uint _response_time) internal {
        address accused;

        require(
            _game.state != GameState.searching_opponent &&
            _game.state != GameState.waiting_opponent,
            "Game has not started"
        );

        if(_game.state == GameState.waiting_stake) {
            accused = _game.creator;
        } else if (_game.state == GameState.confirming_stake) {
            accused = _game.opponent;
        }

        require(
            _game.state == GameState.playing,
            "Game has not started"
        );

        if (msg.sender == GameFunction.getCurrBreaker(_game,true)) {
            require(
                _game.turn.state == TurnState.defining_secret ||
                _game.turn.state == TurnState.giving_feedback ||
                _game.turn.state == TurnState.revealing_code,
                "Cannot accuse during own phase"
            );

            accused = GameFunction.getCurrBreaker(_game,false);
        } else {
            require(
                _game.turn.state == TurnState.guessing ||
                _game.turn.state == TurnState.turn_over,
                "Cannot accuse during own phase"
            );

            accused = GameFunction.getCurrBreaker(_game,true);
        }

        require(
            block.timestamp > _game.turn.lock_time,
            "Cannot accuse during turn lock time");

        require(_game.afk_timer[accused] == 0, "Already accused");
        _game.afk_timer[accused] = block.timestamp + _response_time;
    }
}
