// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * @dev Enum representing the states of a Mastermind game:
 *      -   searching_opponent: no opp specified
 *      -   waiting_opponent: opp found or specified, waiting for opp to join
 *      -   waiting_stake: waiting for creator to stake
 *      -   confirming_stake: waiting for opponent to stake -> simple match for now
 *      -   ready: players have joined and game is staked
 *      -   playing: game in progress, alternating turns
 *      -   completed: game over
 *                                                         
 * ┌────────────────────┐       ┌──────────────────┐      
 * │ searching_opponent ├────┐  │ waiting_opponent │      
 * └────────────────────┘    │  └──────┬───────────┘      
 *                           │         │                  
 *                           ▼         ▼                  
 * ┌──────────────────┐    ┌───────────────┐              
 * │ confirming_stake │◄──►│ waiting_stake │              
 * └───┬──────────────┘    └───────────────┘              
 *     │                                                  
 *     ▼                                                  
 * ┌───────┐        ┌─────────┐       ┌───────────┐       
 * │ ready ├───────►│ playing ├──────►│ completed │       
 * └───────┘        └─────────┘       └───────────┘       
 *                                                        
 */
enum GameState {
    searching_opponent,
    waiting_opponent,
    waiting_stake,
    confirming_stake,
    ready,
    playing,
    completed
}

/**
 * @dev Internal state of a Mastermind game
 */
struct Game {
    // General game info
    bytes32 uuid; 
    address creator;
    address opponent;

    // Static game parameters
    uint guess_amt;
    uint turns_amt;

    // User set parameters
    uint stake;
    uint bonus;
    uint code_len;
    uint code_symbols_amt;

    // Current game state
    GameState state;
    Turn turn;
    uint curr_turn;
        // The player that acts as the CodeBreaker during the first round
    bool creator_is_first_breaker;
}

/**
 * @dev Enum representing tate of a Mastermind turn instance:
 *      -   defining_secret: waiting for CodeMaker to define secret
 *      -   guessing: waiting for CodeBreaker to send guess
 *      -   giving_feedback: waiting for CodeMaker to give feedback
 *      -   revealing_code: waiting for CodeMaker to reveal code AND salt
 *      -   turn_over: turn is over, add TDispt to variable lock_time
 * 
 *   ┌─────────────────┐                     
 *   │ defining_secret │                     
 *   └───┬─────────────┘                     
 *       │                                   
 *       ▼                                   
 *   ┌──────────┐         ┌─────────────────┐ 
 *   │ guessing │◄───────►│ giving_feedback │ 
 *   └──────────┘         └────────┬────────┘ 
 *                                 │      
 *                                 ▼        
 *                        ┌────────────────┐   ┌───────────┐   
 *                        │ revealing_code ├──►│ turn_over │   
 *                        └────────────────┘   └───────────┘   
 */
enum TurnState {
    defining_secret,
    guessing,
    giving_feedback,
    revealing_code,
    turn_over
}


/**
 * @dev Representation of a Mastermind turn 

struct Turn {
    mapping(uint => Guess) guesses;
    uint curr_guess;
    bytes32 code_hash;

    // Turn state
    TurnState state;
    // Time after which the Turn will not be able to be disputed
    // meaning lock_time = T_endTurn + T_dispute
    uint lock_time;

    // Set at the end of the turn
    bytes4 salt;
    mapping(uint => bytes1) code_solution;
}*/

struct Turn {
    bytes2 root_node;
    bytes4 salt;
    bytes16 code_hash;
    uint16 curr_guess;
    TurnState state;
    uint lock_time;
    mapping(bytes2 => bytes8) nodes;
}

struct Guess {
    bytes1 a;
}

library StateMachine {
    function nextState(Game storage _game) internal {
        if(_game.state == GameState.searching_opponent) {
            _game.state = GameState.waiting_stake;
        }

        if(_game.state == GameState.waiting_opponent) {
            _game.state = GameState.waiting_stake;
        }

        if(_game.state == GameState.waiting_stake) {
            _game.state = GameState.confirming_stake;
        }

        if(
            _game.state == GameState.confirming_stake &&
            _game.stake == 0
        ) {
            _game.state = GameState.waiting_stake;
        }

        if(
            _game.state == GameState.confirming_stake &&
            _game.stake != 0
        ) {
            _game.state = GameState.ready;
        }

        if(_game.state == GameState.ready) {
            _game.state = GameState.playing;
        }

        if(_game.state == GameState.playing) {
            _game.state == GameState.completed;
        }
    }

    function nextTurnState(Game storage _game) internal {
        if(_game.state == GameState.completed) {
            _game.turn.state = TurnState.turn_over;
        }

        if(_game.turn.state == TurnState.defining_secret) {
            _game.turn.state = TurnState.guessing;
        }

        if(_game.turn.state == TurnState.guessing) {
            _game.turn.state = TurnState.giving_feedback;
        }

        if(
            _game.turn.state == TurnState.giving_feedback &&
            _game.turn.curr_guess >= _game.guess_amt
        ) {
            _game.turn.state = TurnState.revealing_code;
        }

        if(
            _game.turn.state == TurnState.giving_feedback &&
            _game.turn.curr_guess < _game.guess_amt
        ) {
            _game.turn.state = TurnState.guessing;
        }

        if(_game.turn.state == TurnState.revealing_code) {
            _game.turn.state == TurnState.turn_over;
        }
    }
}