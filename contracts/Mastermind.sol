// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "hardhat/console.sol";

/**
 * @dev Internal state of a Mastermind game
 */
struct Game {
    // General game info
    //bytes32 uuid; 
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
    bytes32 secret;

    // Current game state
    GameState state;
    Turn[] turns;
}

/**
 * @dev Representation of a Mastermind turn 
 */
struct Turn {
    Guess[] guesses;
}

/**
 * @dev Representation of a Mastermind guess:
 *      -   guess should be an array of code_len
 *      -   uint contains the CC and the NC values
 */
struct Guess {
    bytes1[] guess;
    // idx 0 -> CC (pos, symbol)
    // idx 1 -> NC (!pos, symbol)
    uint[2] response;
}

/**
 * @dev Enum representing the states of a Mastermind game:
 *      -   searching_opponent: no opp specified
 *      -   waiting_opponent: opp found or specified, waiting for opp to join
 *      -   waiting_stake: stake definition in progress
 *      -   creator_turn / opponent_turn: game in progress, turn specification
 *      -   completed: game over, scores tallied up, waiting TDisp
 *      -   locked: TDisp expired, game archived, stake paid
 */
enum GameState {
    searching_opponent,
    waiting_opponent,
    waiting_stake,
    creator_turn,
    opponent_turn,
    completed,
    locked
}

/**
 * @title Mastermind
 * @notice The smart contract implements the game "Mastermind"
 */
contract Mastermind {
    mapping(bytes32 => Game) games;


    // Game Creation

    /**
     * @dev Generates the UUID of a new game using the sender's address and the
     *      block timestamp.
     */
    function createGameUUID() private view returns(bytes32) {
        return keccak256(abi.encodePacked(block.timestamp,msg.sender));
    }
    
    /**
     * 
     * @param _opponent The address of the opponent, to not specify an opponent
     *                  insert address 0 or omit parameter.
     * @param _code_len The length of the code to guess.
     * @param _code_symbols_amt Amount of colors (symbols) that can be used to
     *                          construct the code.
     * @param _bonus Bounus points given when CodeBreaker runs out of guesses.
     * 
     * @return game_id Id of the newly created game.
     */
    function createGame(
        address _opponent,
        uint _code_len,
        uint _code_symbols_amt,
        uint _bonus
    ) 
    public returns(bytes32) {
        // Get game id
        bytes32 game_id = createGameUUID();

        // Initialize empty game struct in function memory
        Game memory game;

        // Set players
        game.creator = msg.sender;

        if (_opponent == address(0)) {
            game.state = GameState.searching_opponent;
        } else {
            game.opponent = _opponent;
            game.state = GameState.waiting_opponent;
        }

        // Set game parameters
        game.bonus = _bonus;
        game.guess_amt = 10;
        game.turns_amt = 2;

        game.code_len = _code_len;
        game.code_symbols_amt = _code_symbols_amt;

        // Insert game in storage
        games[game_id] = game;

        // Return game_id
        return game_id;
    }

    function joinGame(
        bytes32 _game_id
    ) public {}
}