// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "hardhat/console.sol";

import "./lib/Helper.sol";
import "./lib/GameState.sol";
import "./lib/Lobby.sol";

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
        emit GameReady(game.uuid, block.timestamp);
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

    function beginGame(Game storage _game) private {
        require(_game.state == GameState.ready, "[Internal Error] Supplied game cannot be started");
        //TODO
        // emit beginTurn(codemaker, codebreaker)
    }
}