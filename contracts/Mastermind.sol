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
    uint t_disp = 60; 

    // AFK time
    uint t_afk = 360;

    //-----------------
    //     EVENTS
    //-----------------

    /**
     * @dev Log a successful game instance
     * @param _game_id Id of the game associated with the match
     */
    event GameCreated(bytes32 indexed _game_id, address indexed _game_creator);

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

    event StakeFailed(bytes32 indexed _game_id, uint _opp_stake);

    event StakeSent(bytes32 indexed _game_id, uint _stake);

    /**
     * @dev Log the beginning of the game
     * @param _game_id Id of the game
     * @param _creator_is_first_breaker Self explanatory name
     */
    event GameStart( bytes32 indexed _game_id, bool _creator_is_first_breaker);

    event SecretSet( bytes32 indexed _game_id, uint _turn_num);

    event GuessSent( bytes32 indexed _game_id, uint _turn_num, bytes16 _guess);

    event FeedbackSent( bytes32 indexed _game_id, uint _turn_num, bytes2 _feedback);

    event TurnOver( bytes32 indexed _game_id, uint _turn_num, bytes16 _code_sol);

    event GameWinner( bytes32 indexed _game_id, address _winner);

    event disputeSent( bytes32 indexed _game_id, address _sender);

    event disputeWon( bytes32 indexed _game_id, address _winner);


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
        uint8 _code_len,
        uint8 _code_symbols_amt,
        uint _bonus
    ) 
    public returns(bytes32) {
        require(_opponent != msg.sender, "The opponent cannot be the game creator");
        
        // Get game id
        bytes32 game_id = Helper.create_game_uuid();

        // Initialize empty game struct in storage
        Game storage game = games[game_id];

        // Set players
        game.creator = msg.sender;
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
        // console.log("Game ID: ");
        // console.logBytes32(game_id);
        emit GameCreated(game_id, game.creator);
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
            _game_id = searching_games[0];
            Helper.pop_first(searching_games);
        }
        Game storage game = games[_game_id];

        //If sender is not the designated opponent revert
        LobbyFunction.addOpponent(game, msg.sender);

        // Emit game readiness signal, useful for the client, will be used with web3.js or python
        emit PlayersReady(_game_id, block.timestamp);
    }

    /**
     * @dev Modeled on the example 
     *      https://docs.soliditylang.org/en/latest/solidity-by-example.html#simple-open-auction
     * @param _game_id Id of the game to stake
     */
    function proposeStake(
        bytes32 _game_id
    )
    payable public {
        Game storage game = games[_game_id];
        
        LobbyFunction.manageStake(game);

        if (game.state == GameState.ready) {
            emit StakeSuccessful(_game_id, msg.value);
            GameFunction.beginGame(game);
            emit GameStart(_game_id, game.creator_is_first_breaker);
        } else if (game.state == GameState.waiting_stake) {
            emit StakeFailed(_game_id, msg.value);
            pending_return[game.creator] += game.stake;
            pending_return[game.opponent] += msg.value;
        } else {
            emit StakeSent(_game_id, game.stake);
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
     * @dev Set secret code hash
     * @param _game_id id of the game
     * @param _code_hash hash of the secret code
     */
    function setCodeHash(bytes32 _game_id, bytes32 _code_hash) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);
        GameFunction.setTurnCode(game,_code_hash);
        emit SecretSet(_game_id, game.curr_turn);
        StateMachine.nextTurnState(game);
    }

    /**
     * @dev Add a Guess to a Game Turn
     * @param _game_id Id of the game
     * @param _guess guess code
     */    
    function guess(bytes32 _game_id, bytes16 _guess) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);
        GameFunction.addGuess(game, _guess);

        // Update turn state
        StateMachine.nextTurnState(game);
        emit GuessSent(_game_id, game.curr_turn, _guess);
    }

    /**
     * @dev Add feedback to a Guess of a Game Turn
     * @param _game_id Id of the game
     * @param _feedback Feedback value
     */
    function giveFeedback(
        bytes32 _game_id,
        bytes2 _feedback
    ) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);
        //If you submit different feedback for the same guess you lose since you cheated
        if (GameFunction.addFeedback(game, _feedback)) {
            StateMachine.nextTurnState(game);
            emit FeedbackSent(_game_id,game.curr_turn,_feedback);
        } else {
            GameFunction.forceGameOver(game,GameFunction.getCurrBreaker(game, true));
        }
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
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);

        // If the revealed code or salt is wrong instant game over
        // CodeMaker loses its stake forever
        // else finish turn
        if(!GameFunction.isSolCorrect(game, _code_sol, _salt)) {
            GameFunction.forceGameOver(game,GameFunction.getCurrBreaker(game, true));
        } else {
            GameFunction.setSolution(game, _code_sol, _salt);
            StateMachine.nextTurnState(game);
            GameFunction.setTurnLockTime(game, t_disp);
            emit TurnOver(_game_id, game.curr_turn, _code_sol);

            if (game.curr_turn == game.turns_amt) {
                StateMachine.nextState(game);
                emit GameWinner(_game_id, GameFunction.getWinner(game));
            }
        }
    }
    
    function claimReward(
        bytes32 _game_id
    ) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);

        address accused;
        if(msg.sender == game.creator) {
            accused = game.opponent;
        } else {
            accused = game.creator;
        }

        if (game.afk_timer[accused] != 0 &&
            game.afk_timer[accused] > block.timestamp ) {
            
            GameFunction.forceGameOver(game,msg.sender);
        }
        
        require(
            block.timestamp > game.turn.lock_time,
            "The reward cannot be claimed yet"
        );
        pending_return[GameFunction.getWinner(game)] += (game.stake * 2);
        delete(games[_game_id]);
    }

    function dispute(
        bytes32 _game_id,
        bytes16 _guess
    ) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);
        require(
            block.timestamp < game.turn.lock_time,
            "The turn cannot be disputed"
        );

        emit disputeSent(_game_id, msg.sender);

        address winner;

        if (GameFunction.hasMakerCheated(game,_guess)) {
            winner = GameFunction.getCurrBreaker(game, true);
            GameFunction.forceGameOver(game,winner);
        } else {
            winner = GameFunction.getCurrBreaker(game, false);
            GameFunction.forceGameOver(game,winner);
        }

        emit disputeWon(_game_id, winner);

        delete(games[_game_id]);
    }

    function accuseAFK(
        bytes32 _game_id
    ) public {
        Game storage game = games[_game_id];
        Helper.validateSenderIdentity(game);
        Helper.accuseAFK(game,t_afk);
    }
}