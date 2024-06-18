// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";
import "hardhat/console.sol";

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

        require(
            block.timestamp > _game.turn.lock_time,
            "Wait for last turn to lock"
        );

        _game.score[getCurrBreaker(_game,false)] += _game.turn.curr_guess;
        if(_game.turn.curr_guess == _game.guess_amt) 
            _game.score[getCurrBreaker(_game,false)] += _game.bonus;
        if (_game.curr_turn != 0) delete(_game.turn);
        _game.curr_turn += 1;
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
            _game.turn.state == TurnState.turn_over ||
            _game.curr_turn == 0,
            "Wrong turn state"
        );

        nextTurn(_game);

        require(
            _game.turn.state == TurnState.defining_secret,
            "Wrong turn state"
        );

        require(
            msg.sender == getCurrBreaker(_game, false),
            "Cannot set code during opponent's turn"
        );

        _game.turn.code_hash = _code_hash;
    }

    /**
     * @dev Get the current breaker of the game or the current maker, the mode parameter sets
     *      which one gets retrieved
     * @param _game The game from which the info is derived
     * @param _mode The retrieval mode:
     *                  -true:  get current breaker
     *                  -false: get current maker
     */
    function getCurrBreaker(
        Game storage _game,
        bool _mode
    ) internal view returns (address) {
        address[2] memory players = 
        checkMode(_game.creator_is_first_breaker, _mode) ? 
        [_game.opponent, _game.creator] : [_game.creator,_game.opponent];
        return players[_game.curr_turn % 2];
    }

    function checkMode(bool a, bool b) public pure returns (bool) {
        if (a && b) return true;
        if (a && !b) return false; 
        if (!a && b) return false; 
        if (!a && !b) return true; 
        
        return false;
    }
    
    /**
     * @dev Add a Guess struct to current turn
     * @param _game Game to which the Guess is added
     * @param _guess array of guess symbols 
     */
    function addGuess(
        Game storage _game,
        bytes16 _guess
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
        _game.turn.guess = _guess;
    }

    /**
     * @dev Add feedback to the current Guess entry
     * @param _game Game whose current Guess entry is edited 
     * @param _feedback Feedback values to be added
     */
    function addFeedback(
        Game storage _game,
        bytes2 _feedback
    ) internal returns (bool) {
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

        if (bytes2(_game.turn.feedback[_game.turn.guess]) != _feedback && 
            _game.turn.feedback[_game.turn.guess] != 0) {
            return false;
        }

        bytes3 _feedback_flagged = bytes3(_feedback) | 0x000001;
        _game.turn.feedback[_game.turn.guess] = _feedback_flagged;
        _game.turn.curr_cc = uint8(bytes1(_feedback));
        return true;
    }

    function forceGameOver(Game storage _game, address _winner) internal {
        StateMachine.nextState(_game);
        StateMachine.nextTurnState(_game);
        GameFunction.setTurnLockTime(_game, 0);

        if (_winner == _game.creator) {
            _game.score[_game.creator] = 1;
            _game.score[_game.opponent] = 0;
        } else {
            _game.score[_game.opponent] = 1;
            _game.score[_game.creator] = 0;
        }
    }

    /**
     * @dev Set the solution of the current Turn
     * @param _game Game whose current Turn entry is edited  
     * @param _code Solution code
     */
    function setSolution(
        Game storage _game,
        bytes16 _code
        // bytes4 _salt
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
        _game.turn.guess = _code;
    }

    /**
     * @dev Check the correctness of the supplied solution code of the last Turn
     * @param _game Game whose last Turn gets checked
     * @param _code Solution code
     */
    function isSolCorrect(
        Game storage _game,
        bytes16 _code,
        bytes4 _salt
    ) internal view returns (bool) {

        //Check if the symbol value is superior to the symbol amt
        for(uint8 i = 0; i < _game.code_len; i++) {
            if(uint8(bytes1(_code >> 8*i)) > _game.code_symbols_amt) {
                return false;
            }
        }

        return _game.turn.code_hash == keccak256(abi.encodePacked(_code,_salt));
    }

    function setTurnState(Game storage _game, TurnState _state) internal {
        _game.turn.state = _state;
    }

    function setTurnLockTime(Game storage _game, uint _t_disp) internal {
        _game.turn.lock_time = block.timestamp + _t_disp;
    }

    function getWinner(Game storage _game) internal view returns(address) {
        //Check game state
        require(
            _game.state == GameState.completed,
            "Cannot get winner while game is not completed"
        );
        if (_game.score[_game.creator] > _game.score[_game.opponent]) {
            return _game.creator;
        } else {
            return _game.opponent;
        }
    }

    function hasMakerCheated(Game storage _game, bytes16 _guess) internal view returns(bool) {
        bytes3 feedback = _game.turn.feedback[_guess];

        uint8 stored_cc = uint8(bytes1(feedback));
        uint8 stored_nc = uint8(bytes1(feedback << 8));
        uint8 exist_flag = uint8(bytes1(feedback << 16));
        //console.log("sCC",stored_cc,"sNC",stored_nc);
        //console.log("EX",exist_flag);

        if(exist_flag == 0) {
            return false;
        }

        bytes16 sol = _game.turn.guess;

        uint8 cc;
        uint8 nc;

        bytes16 sol_guess_xor = sol ^ _guess;

        uint8[40] memory missing;

        //uint256 missing;

        for(uint8 i = 0; i < _game.code_len; i++) {
            if(bytes1(sol_guess_xor << 8*i) == 0) {
                cc += 1;
            } else {
                //missing = missing | uint256(1) << uint8(bytes1(_guess << 8*i));
                missing[uint8(bytes1(_guess << 8*i))] += 1;
            }
        }

        for(uint8 i = 0; i < _game.code_len; i++) {
            //uint8 n = uint8( (missing >> uint8(bytes1(sol << 8*i))) & uint256(1) );
            uint8 n = missing[uint8(bytes1(sol << 8*i))];
            if (n != 0) {
                nc += n;
                missing[uint8(bytes1(sol << 8*i))] -= 1;
            }
        }

        //console.log("CC",cc,"NC",nc);

        return !((cc == stored_cc) && (nc == stored_nc));
    }
}