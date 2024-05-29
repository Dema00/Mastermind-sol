// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameState.sol";

/**
 * @title Mastermind Game Library
 * @notice Internal methods used by Mastermind to manage game operations
 */
library GameFunction {
    function beginGame(Game storage _game) private {
        require(_game.state == GameState.ready, "[Internal Error] Supplied game cannot be started");
        //TODO
        // emit beginTurn(codemaker, codebreaker)
    }
}