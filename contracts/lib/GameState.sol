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
 * │ searching_opponent ├────┬─►│ waiting_opponent │      
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
    mapping(uint => Turn) turns;
    uint curr_turn;
        // The player that acts as the CodeBreaker during the first round
    address first_code_breaker;
}

/**
 * @dev Enum representing tate of a Mastermind turn instance:
 *      -   defining_secret: waiting for CodeMaker to define secret
 *      -   guessing: waiting for CodeBreaker to send guess
 *      -   giving_feedback: waiting for CodeMaker to give feedback
 *      -   revealing_code: waiting for CodeMaker to reveal code AND salt
 *      -   turn_over: turn is over, waiting TDisp
 *      -   lock: TDisp expired, turn results locked
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
 *                        ┌────────────────┐   ┌───────────┐   ┌──────┐   
 *                        │ revealing_code ├──►│ turn_over ├──►│ lock │   
 *                        └────────────────┘   └───────────┘   └──────┘   
 */
enum TurnState {
    defining_secret,
    guessing,
    giving_feedback,
    revealing_code,
    turn_over,
    lock
}

/**
 * @dev Representation of a Mastermind turn 
 */
struct Turn {
    mapping(uint => Guess) guesses;
    uint guess_num;
    bytes32 code_hash;

    // Set at the end of the turn
    bytes4 salt;
    mapping(uint => bytes1) code_solution;
}

/**
 * @dev Representation of a Mastermind guess:
 *      -   guess should be an array of code_len
 *      -   uint contains the CC and the NC values
 */
struct Guess {
    mapping(uint => bytes1) guess;
    // idx 0 -> CC (pos, symbol)
    // idx 1 -> NC (!pos, symbol)
    uint[2] response;
}