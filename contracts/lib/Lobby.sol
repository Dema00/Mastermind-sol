// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

/**
 * @title Mastermind Lobby Library
 * @notice Internal methods used by Mastermind to manage lobby operations
 */
library Lobby {
    /**
     * @dev Add or register the opponent to an existing game
     * @param _game The game that the opponent is joining
     * @param _opponent The opponent address
     */
    function addOpponent(Game storage _game, address _opponent) internal returns(bool){
        // Check game state
        require(_game.state == GameState.searching_opponent ||
                _game.state == GameState.waiting_opponent,
                "[Internal Error] Game should not be in queue");

        if (_game.state == GameState.searching_opponent) {
            _game.opponent = _opponent;
            _game.state = GameState.waiting_stake;
            return true;
        } else if ( _game.opponent == _opponent &&
                    _game.state == GameState.waiting_opponent ) {
            _game.state = GameState.waiting_stake;
            return true;
        } else {
            return false;
        }
    }
}