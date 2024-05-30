import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MastermindModule = buildModule("MastermindModule", (m) => {
  // Deploy the MastermindHelper library
  // const mastermindHelper = m.library("MastermindHelper");
  // const lobbyFunction = m.library("LobbyFunction");
  // const gameFunction = m.library("GameFunction");

  // Deploy the Mastermind contract and link the libraries
  const mastermind = m.contract("Mastermind", [], {
    // libraries: {
      // MastermindHelper: mastermindHelper,
      // LobbyFunction: lobbyFunction,
      // GameFunction: gameFunction,
    // },
  });

  // return { mastermindHelper, lobbyFunction, gameFunction, mastermind };
  return { mastermind };
});

export default MastermindModule;
