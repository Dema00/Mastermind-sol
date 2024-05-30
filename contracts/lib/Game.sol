// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

/**
 * @title Mastermind Game Library
 * @notice Internal methods used by Mastermind to manage game operations
 */
library GameFunction {

    /**
     * @dev Select first player, set playing game state
     * @param _game Game to start
     */
    function beginGame(Game storage _game) internal {
        require(
            _game.state == GameState.ready,
            "[Internal Error] Supplied game cannot be started"
        );

        uint first_code_breaker = 
            uint(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 2;

        if (first_code_breaker == 1) {
            _game.creator_is_first_breaker = true;
        }

        _game.state = GameState.playing;

        nextTurn(_game);
    }

    /**
     * @dev Advance a game of one turn
     * @param _game Game to advance
     */
    function nextTurn(Game storage _game) internal {
        require(
            _game.state == GameState.playing,
            "Cannot advance game not in playing state"
        );

        require(
            _game.curr_turn < _game.turns_amt,
            "Cannot increment turns further"
        );

        _game.curr_turn += 1;
        Turn storage new_turn = _game.turns[_game.curr_turn];
        new_turn.state = TurnState.defining_secret;
    }

    /**
     * @dev Define a Turn's code hash
     * @param _game Game of which the turn is part of
     * @param _code_hash code hash
     */
    function setTurnCode(Game storage _game, bytes32 _code_hash) internal {
        require(
            _game.state == GameState.playing,
            "Wrong game state"
        );

        Turn storage turn = _game.turns[_game.curr_turn];

        require(
            turn.state == TurnState.defining_secret,
            "Wrong turn state"
        );

        turn.code_hash = _code_hash;
    }

    function getCurrBreaker(Game storage _game) internal returns (address) {
        address[2] memory players = 
        _game.creator_is_first_breaker ? 
        [_game.creator, _game.opponent] : [_game.opponent, _game.creator];
        return players[_game.curr_turn % 2];
    }
    
    function addGuess(Game storage _game, bytes1[] memory _guess) internal {
        require(
            _game.state == GameState.playing,
            "Cannot advance game not in playing state"
        );

        require(
            _game.turns[_game.curr_turn].state == TurnState.guessing,
            "Turn not in guessing state"
        );

        require(
            getCurrBreaker(_game) == msg.sender,
            "Not your guessing turn"
        );

        // Get turn and increase guess amount
        Turn storage turn = _game.turns[_game.curr_turn];
        turn.curr_guess += 1;
        Guess storage guess = turn.guesses[turn.curr_guess];

        for(uint i = 0; i < _game.code_len; i++) {
            guess.guess[i+1] = _guess[i];
        }
    }
}