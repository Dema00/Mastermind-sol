// .load scripts/mmt.js

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const mastermindAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; // Replace with your deployed contract address
  const Mastermind = await hre.ethers.getContractFactory("Mastermind", {
        libraries: {
            MastermindHelper: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        },
        });
  const mastermind = await Mastermind.attach(mastermindAddress);

  // Example: Create a game
  const txCreateGame = await mastermind.createGame(
    "0x0000000000000000000000000000000000000000", // No specific opponent
    4, // Code length
    6, // Number of symbols
    10 // Bonus points
  );

  console.log("Transaction hash for createGame:", txCreateGame.hash);

  // Example: Join a game
  const txJoinGame = await mastermind.joinGame("0"); // Replace with your game ID
  console.log("Transaction hash for joinGame:", txJoinGame.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
