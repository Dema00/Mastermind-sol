import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MastermindModule = buildModule("MastermindModule", (m) => {
  // To deploy the libraries
  // here commented because libraries are used in function with internal statement
  // const mastermindHelper = m.library("MastermindHelper");
  // const lobbyFunction = m.library("LobbyFunction");
  // const gameFunction = m.library("GameFunction");

  // To deploy the Mastermind contract and link the libraries
  const mastermind = m.contract("Mastermind", [], {
    // To link the libraries
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
