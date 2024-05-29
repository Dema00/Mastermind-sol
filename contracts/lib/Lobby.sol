// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

/**
 * @title Mastermind Lobby Library
 * @notice Internal methods used by Mastermind to manage lobby operations
 */
library LobbyFunction {
    /**
     * @dev Add or register the opponent to an existing game
     * @param _game The game that the opponent is joining
     * @param _opponent The opponent address
     */
    function addOpponent(
        Game storage _game,
        address _opponent
    ) internal{
        
        // Check game existence
        require(
            _game.uuid != 0,
            "[Internal Error] Supplied Game does not exist"
        );
        // Check opponent identity
        require(
            _game.creator != _opponent,
            "[Internal Error] Creator and opponent cannot be the same"
        );
        // Check game state
        require(
            _game.state == GameState.searching_opponent ||
            _game.state == GameState.waiting_opponent,
            "[Internal Error] Supplied Game cannot accept opponents"
        );

        if (_game.state == GameState.waiting_opponent) {
            require(
                _game.opponent == _opponent,
                "Opponent cannot join Game"
            );
        } else {
            _game.opponent = _opponent;
        }

        _game.state = GameState.waiting_stake;
    }
}