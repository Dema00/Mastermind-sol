// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "hardhat/console.sol";

import "./lib/Helper.sol";
import "./lib/GameState.sol";
import "./lib/Lobby.sol";
import "./lib/Game.sol";

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

    // Dispute time
    uint t_disp = 60; // 5 Min lock time

    //-----------------
    //     EVENTS
    //-----------------

    /**
     * @dev Log a successful game instance
     * @param _game_id Id of the game associated with the match
     */
    event GameReady(bytes32 _game_id);

    /**
     * @dev Log a successful matchmaking instance
     * @param _game_id Id of the game associated with the match
     * @param _matchmaking_time Timestamp of succesfull matchmaking
     */
    event PlayersReady(bytes32 indexed _game_id, uint _matchmaking_time);

    /**
     * @dev Log a succesfull staking procedure
     * @param _game_id Id of the game
     * @param _stake  Amount staked by both parties
     */
    event StakeSuccessful(bytes32 indexed _game_id, uint _stake);

    /**
     * @dev Log the beginning of the game
     * @param _game_id Id of the game
     * @param _creator_is_first_breaker Self explanatory name
     */
    event GameStart( bytes32 indexed _game_id, bool _creator_is_first_breaker);

    event TurnOver( bytes32 indexed _game_id, uint _turn_num);


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
        require(_opponent != msg.sender, "The opponent cannot be the game creator");
        
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
        console.log("Game ID: ");
        console.logBytes32(game_id);
        emit GameReady(game_id);
        return game_id;
    }

    /**
     * @dev Join a game based on the supplied game id
     * @param _game_id Id of the game to join: 
     *                  -   If 0 search for first available game
     */
    function joinGame(
        bytes32 _game_id
    )
    public {
        //Retrieve Game
        if (_game_id == 0) {
            _game_id = searching_games[searching_games.length];
            MastermindHelper.pop_first(searching_games);
        }
        Game storage game = games[_game_id];

        //If sender is not the designated opponent revert
        LobbyFunction.addOpponent(game, msg.sender);

        // Emit game readiness signal, useful for the client, will be used with web3.js or python
        emit PlayersReady(game.uuid, block.timestamp);
    }

    /**
     * @dev Modeled on the example 
     *      https://docs.soliditylang.org/en/latest/solidity-by-example.html#simple-open-auction
     *      TODO: withdraw function on the example model
     * @param _game_id Id of the game to stake
     */
    function proposeStake(
        bytes32 _game_id
    )
    payable public {
        Game storage game = games[_game_id];
        
        LobbyFunction.manageStake(game);

        if (game.state == GameState.ready) {
            emit StakeSuccessful(game.uuid, msg.value);
            beginGame(game);
        } else if (game.state == GameState.waiting_stake) {
            pending_return[game.creator] += game.stake;
            pending_return[game.opponent] += msg.value;
        }
    }

    /**
     * @dev Wei withdraw function taken from the example 
     *      https://docs.soliditylang.org/en/latest/solidity-by-example.html#simple-open-auction
     */
    function withdraw() 
    external returns (bool) {
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

    /**
     * @dev Begin Game
     * @param _game Game to begin
     */
    function beginGame(Game storage _game) private {
        GameFunction.beginGame(_game);
        emit GameStart(_game.uuid, _game.creator_is_first_breaker);
    }

    /**
     * @dev Set secret code hash
     * @param _game_id id of the game
     * @param _code_hash hash of the secret code
     */
    function setCodeHash(bytes32 _game_id, bytes32 _code_hash) public {
        Game storage game = games[_game_id];
        MastermindHelper.validateSenderIdentity(game);
        GameFunction.setTurnCode(game,_code_hash);
    }

    /**
     * @dev Add a Guess to a Game Turn
     * @param _game_id Id of the game
     * @param _guess guess code
     */    
    function guess(bytes32 _game_id, bytes16 _guess) public {
        //TODO Add length check to all arrays
        Game storage game = games[_game_id];
        MastermindHelper.validateSenderIdentity(game);
        GameFunction.addGuess(game, _guess);

        // Update turn state
        StateMachine.nextTurnState(game);
        //TODO
    }

    /**
     * @dev Add feedback to a Guess of a Game Turn
     * @param _game_id Id of the game
     * @param _feedback Feedback value
     */
    function giveFeedback(
        bytes32 _game_id,
        bytes1 _feedback
    ) public {
        //TODO Add length check to all arrays
        Game storage game = games[_game_id];
        MastermindHelper.validateSenderIdentity(game);
        GameFunction.addFeedback(game, _feedback);
        StateMachine.nextTurnState(game);
    }

    /**
     * @dev Set the solution code, check the correctness of it
     * @param _game_id Id of the game
     * @param _code_sol Solution code
     * @param _salt Solution salt
     */
    function revealCode(
        bytes32 _game_id,
        bytes16 _code_sol,
        bytes4 _salt
    ) public {
        //TODO Add length check to all arrays
        Game storage game = games[_game_id];
        MastermindHelper.validateSenderIdentity(game);

        // If the revealed code or salt is wrong instant game over
        // CodeMaker loses its stake forever
        // else finish turn
        if(!GameFunction.isSolCorrect(game, _code_sol, _salt)) {
            StateMachine.nextState(game);
            StateMachine.nextTurnState(game);
            GameFunction.setTurnLockTime(game, 0);
            pending_return[GameFunction.getCurrBreaker(game, true)] += (game.stake * 2);
        } else {
            GameFunction.setSolution(game, _code_sol, _salt);
            emit TurnOver(game.uuid, game.curr_turn);
            StateMachine.nextTurnState(game);
            GameFunction.setTurnLockTime(game, t_disp);
        }
    }
}