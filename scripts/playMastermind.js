// .load scripts/playMastermind.js

const hre = require("hardhat");
const ethers = hre.ethers;

// async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const mastermindAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Replace with your deployed contract address
  const Mastermind = await hre.ethers.getContractFactory("Mastermind", {
        // libraries: {
        //     MastermindHelper: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        // },
        });
  const game = await Mastermind.attach(mastermindAddress);

  // Example: Create a game
  // const txCreateGame = await game.createGame(
  //   "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // No specific opponent
  //   4, // Code length
  //   6, // Number of symbols
  //   10 // Bonus points
  // );

  const txCreateGame2 = await game.createGame(
    "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // No specific opponent
    4, // Code length
    6, // Number of symbols
    10 // Bonus points
  );

  // console.log("Transaction hash for createGame:", txCreateGame.hash);
  console.log("Transaction hash for createGame:", txCreateGame2.hash);

  // Example: Join a game
  // const txJoinGame = await mastermind.joinGame("0"); // Replace with your game ID
  // console.log("Transaction hash for joinGame:", txJoinGame.hash);
// }

// main()
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });
