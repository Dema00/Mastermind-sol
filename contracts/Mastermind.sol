// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "hardhat/console.sol";

/**
 * @dev Enum representing the states of a Mastermind game:
 *      -   searching_opponent: no opp specified
 *      -   waiting_opponent: opp found or specified, waiting for opp to join
 *      -   waiting_stake: waiting for creator to stake
 *      -   confirming_stake: waiting for opponent to stake -> simple match for now
 *      -   ready: players have joined and game is staked
 *      -   playing: game in progress, alternating turns
 *      -   completed: game over
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

library MastermindHelper {
    
    /**
     * @dev Terrible and ugly function to pop the first element of an array
     */
    function pop_first(bytes32[] storage arr) public {
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
    function create_game_uuid() public view returns(bytes32) {
        return keccak256(abi.encodePacked(block.timestamp,msg.sender));
    }
}

/**
 * @title Mastermind
 * @notice The smart contract implements the game "Mastermind"
 */
contract Mastermind {
    // Active games
    mapping(bytes32 => Game) games;
    // Mapping to keep track of failed staking attempt funds 
    mapping(address => uint) pending_return;

    // Pool of available open games
    bytes32[] searching_games;

    //-----------------
    //     EVENTS
    //-----------------

    /**
     * @dev Log a successful matchmaking instance
     * @param _game_id Id of the game associated with the match
     * @param _ready_time Timestamp of succesfull matchmaking
     */
    event GameReady(bytes32 indexed _game_id, uint _ready_time);

    /**
     * @dev Log a succesfull staking procedure
     * @param _game_id Id of the game
     * @param _stake  Amount staked by both parties
     */
    event StakeSuccessful(bytes32 indexed _game_id, uint _stake);


    //-----------------
    //     ERRORS
    //-----------------

    error FailedStake();

    //------------------
    //  LOBBY METHODS
    //------------------
    
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
        //TODO require _opponent != msg.sender
        // Get game id
        bytes32 game_id = MastermindHelper.create_game_uuid();

        // Initialize empty game struct in storage
        Game storage game = games[game_id];

        // Set players
        game.creator = msg.sender;
        game.uuid = game_id;

        if (_opponent == address(0)) {
            game.state = GameState.searching_opponent;
            searching_games.push(game_id);
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

        // Return game_id
        return game_id;
    }

    /**
     * @dev Add or register the opponent to an existing game
     * @param _game The game that the opponent is joining
     * @param _opponent The opponent address
     */
    function addOpponent(Game storage _game, address _opponent) internal {
        // Check game state
        require(_game.state == GameState.searching_opponent ||
                _game.state == GameState.waiting_opponent,
                "[Internal Error] Game should not be in queue");

        if (_game.state == GameState.searching_opponent) {
            _game.opponent = _opponent;
            _game.state = GameState.waiting_stake;
        } else if ( _game.opponent == _opponent &&
                    _game.state == GameState.waiting_opponent ) {
            _game.state = GameState.waiting_stake;
        } else {
            revert("You are not allowed to join this game");
        }

        // Emit game readiness signal, useful for the client, will be used with web3.js or python
        emit GameReady(_game.uuid, block.timestamp);
    }

    /**
     * @dev Join a game based on the supplied game id
     * @param _game_id Id of the game to join: 
     *                  -   If 0 search for first available game
     */
    function joinGame(
        bytes32 _game_id
    ) public {
        //TODO check if the player is joining its own game
        Game storage game;
        if (_game_id == 0) {
            require(searching_games.length != 0, "No games available");
            game = games[searching_games[searching_games.length]];

            // Remove game from matchmaking pool
            MastermindHelper.pop_first(searching_games);
        } else {
            game = games[_game_id];
        }

        addOpponent(game, msg.sender);
    }

    /**
     * @dev Modeled on the example 
     *      https://docs.soliditylang.org/en/latest/solidity-by-example.html#simple-open-auction
     *      TODO: withdraw function on the example model
     * @param _game_id Id of the game to stake
     */
    function proposeStake(bytes32 _game_id) payable public {
        require(_game_id != 0, "No game specified");
        Game storage game = games[_game_id];
        
        require(
            game.state == GameState.waiting_stake 
            || game.state == GameState.confirming_stake, 
            "Game not in staking phase");
        require(game.uuid != 0, "No game with the supplied id");
        require(game.opponent == msg.sender
                || game.creator == msg.sender,
                "Sender not part of game");
        require(
                (
                    (game.creator == msg.sender) &&
                    (game.state == GameState.waiting_stake)
                )
                ||
                (
                    (game.opponent == msg.sender) &&
                    (game.state == GameState.confirming_stake)
                ),
                "Not message sender staking turn"
            );

        // If you are the creator the games needs to be in waiting_stake
        // If you are the opponent the games needs to be in confirming_stake
        if (game.state == GameState.waiting_stake) {
            game.stake = msg.value;
            game.state = GameState.confirming_stake;
        } else if (game.state == GameState.confirming_stake &&
            game.stake == msg.value) {
            game.state = GameState.ready;
            emit StakeSuccessful(game.uuid, msg.value);
            beginGame(game);
        } else if (game.state == GameState.confirming_stake && game.stake != msg.value) {
            game.state = GameState.waiting_stake;
            //Add failed staking funds to withdrawable funds
            pending_return[game.creator] += game.stake;
            pending_return[game.opponent] += msg.value;
        }

    }

    /**
     * @dev Wei withdraw function taken from the example 
     *      https://docs.soliditylang.org/en/latest/solidity-by-example.html#simple-open-auction
     */
    function withdraw() external returns (bool) {
        uint amount = pending_return[msg.sender];
        if (amount > 0) {
            // It is important to set this to zero because the recipient
            // can call this function again as part of the receiving call
            // before `send` returns.
            pending_return[msg.sender] = 0;

            // msg.sender is not of type `address payable` and must be
            // explicitly converted using `payable(msg.sender)` in order
            // use the member function `send()`.
            if (!payable(msg.sender).send(amount)) {
                // No need to call throw here, just reset the amount owing
                pending_return[msg.sender] = amount;
                return false;
            }
        }
        return true;
    }

    //------------------
    //   GAME METHODS
    //------------------

    function beginGame(Game storage _game) private {
        require(_game.state == GameState.ready, "[Internal Error] Supplied game cannot be started");
        //TODO
        // emit beginTurn(codemaker, codebreaker)
    }
}