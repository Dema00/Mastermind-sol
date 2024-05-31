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
        delete(_game.turn);
        _game.turn.state = TurnState.defining_secret;
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

        require(
            _game.turn.state == TurnState.defining_secret,
            "Wrong turn state"
        );

        _game.turn.code_hash = _code_hash;
    }

    /**
     * @dev Get the current breaker of the game or the current maker, the mode parameter sets
     *      which one gets retrieved
     * @param _game The game from which the info is derived
     * @param _mode The retrieval mode:
     *                  -true:  get breaker
     *                  -false: get maker
     */
    function getCurrBreaker(
        Game storage _game,
        bool _mode
    ) internal view returns (address) {
        address[2] memory players = 
        (_game.creator_is_first_breaker && _mode) ? 
        [_game.creator, _game.opponent] : [_game.opponent, _game.creator];
        return players[_game.curr_turn % 2];
    }
    
    /**
     * @dev Add a Guess struct to current turn
     * @param _game Game to which the Guess is added
     * @param _guess array of guess symbols 
     * TODO CHECK ARRAY LEN
     */
    function addGuess(
        Game storage _game,
        bytes1[] memory _guess
    ) internal {
        require(
            _game.state == GameState.playing,
            "Cannot advance game not in playing state"
        );

        require(
            _game.turn.state == TurnState.guessing,
            "Turn not in guessing state"
        );

        require(
            getCurrBreaker(_game, true) == msg.sender,
            "Not your guessing turn"
        );

        // Get turn and increase guess amount
        _game.turn.curr_guess += 1;
        Guess storage guess = _game.turn.guesses[_game.turn.curr_guess];

        // Set guess content in Guess
        for(uint i = 0; i < _game.code_len; i++) {
            guess.guess[i+1] = _guess[i];
        }
    }

    /**
     * @dev Add feedback to the current Guess entry
     * @param _game Game whose current Guess entry is edited 
     * @param _feedback Feedback values to be added
     */
    function addFeedback(
        Game storage _game,
        uint[2] calldata _feedback
    ) internal {
        require(
            _game.state == GameState.playing,
            "Cannot advance game not in playing state"
        );

        require(
            _game.turn.state == TurnState.giving_feedback,
            "Turn not in giving_feedback state"
        );

        require(
            getCurrBreaker(_game, false) == msg.sender,
            "Not your feedback turn"
        );

        // Get curr turn and curr guess
        Guess storage guess = _game.turn.guesses[_game.turn.curr_guess];

        guess.response = _feedback;
    }

    /**
     * @dev Set the solution of the current Turn
     * @param _game Game whose current Turn entry is edited  
     * @param _code Solution code
     * @param _salt Salt of the secret_hash entry 
     */
    function setSolution(
        Game storage _game,
        bytes1[] calldata _code,
        bytes4 _salt
    ) internal {

        //Check game state
        require(
            _game.state == GameState.playing,
            "Cannot advance game not in playing state"
        );

        //Check turn state
        require(
            _game.turn.state == TurnState.revealing_code,
            "Turn not in giving_feedback state"
        );

        //Check sender identity
        require(
            getCurrBreaker(_game, false) == msg.sender,
            "Message sender is not the codemaker"
        );

        // Set code_solution content in Turn
        for(uint i = 0; i < _game.code_len; i++) {
            _game.turn.code_solution[i+1] = _code[i];
        }
        _game.turn.salt = _salt;
    }

    /**
     * @dev Check the correctness of the supplied solution code of the last Turn
     * @param _game Game whose last Turn gets checked
     * @param _code Solution code
     * @param _salt Solution salt
     */
    function isSolCorrect(
        Game storage _game,
        bytes1[] calldata _code,
        bytes4 _salt
    ) internal view returns (bool) {
        return _game.turn.code_hash == keccak256(abi.encodePacked(_code,_salt));
    }

    function setTurnState(Game storage _game, TurnState _state) internal {
        _game.turn.state = _state;
    }

    function setTurnLockTime(Game storage _game, uint _t_disp) internal {
        _game.turn.lock_time = block.timestamp + _t_disp;
    }
}