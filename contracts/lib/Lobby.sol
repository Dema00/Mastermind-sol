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
        
        // Check existence
        require(
            _game.creator != address(0),
            "[Internal Error] Supplied Game does not exist"
        );
        // Check identity
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

        StateMachine.nextState(_game);
    }

    /**
     * @dev Validate and execute a staking operation
     * @param _game Game being staked
     */
    function manageStake(
        Game storage _game
    ) internal returns(uint){

        // Check existence
        require(
            _game.creator != address(0),
            "[Internal Error] Supplied Game does not exist"
        );
        // Check game state
        require(
            _game.state == GameState.waiting_stake 
            || _game.state == GameState.confirming_stake, 
            "Game not in staking phase"
        );

        // Check identity
        require(_game.opponent == msg.sender
            || _game.creator == msg.sender,
            "Sender not part of game"
        );

        // Check turn
        require(
            (
                (_game.creator == msg.sender) &&
                (_game.state == GameState.waiting_stake)
            ) || (
                (_game.opponent == msg.sender) &&
                (_game.state == GameState.confirming_stake)
            ),
            "Not message sender staking turn"
        );

        uint game_stake = _game.stake;

        // If you are the creator the games needs to be in waiting_stake
        // If you are the opponent the games needs to be in confirming_stake
        if (_game.state == GameState.waiting_stake) {
            _game.stake = msg.value;
        } else if (_game.state == GameState.confirming_stake &&
            _game.stake != msg.value) {
            delete(_game.stake);
        }

        StateMachine.nextState(_game);

        return game_stake;
    }
}