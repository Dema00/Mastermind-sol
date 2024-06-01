// .load scripts/playMastermind.js

const hre = require("hardhat");
const ethers = hre.ethers; // With it you should access the utils object from the ethers library

// async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const mastermindAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Replace with your deployed contract address
  const Mastermind = await hre.ethers.getContractFactory("Mastermind", {
        // libraries: {
        //     MastermindHelper: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        // },
        });
  const game = await Mastermind.attach(mastermindAddress);

  const accounts = await hre.ethers.getSigners();

  // Example: Create a game
  // const txCreateGame = await game.createGame(
  //   "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // No specific opponent
  //   4, // Code length
  //   6, // Number of symbols
  //   10 // Bonus points
  // );

  const txGame = await game.createGame(
    "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // No specific opponent
    4, // Code length
    6, // Number of symbols
    10 // Bonus points
  );

  // console.log("Transaction hash for createGame:", txCreateGame.hash);
  console.log("Transaction hash for createGame:", txGame.hash);

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

const abiCoder = new ethers.utils.AbiCoder();
const defaultAbiCoder = ethers.utils.defaultAbiCoder;
const returnData = txGame.data;

// Decode the return data
ethers.utils.defaultAbiCoder.decode(["bytes32"], returnData);
const gameid = abiCoder.decode(["bytes32"], returnData);
console.log("Decoded Data:", gameid);

///////////////////////////////////////////////////////////


const contractAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3"; // Replace with your contract address
const abi = [
    // ABI entry for createGame function
    "function createGame(address _opponent, uint _code_len, uint _code_symbols_amt, uint _bonus) public returns (bytes32)",
    
    // ABI entry for proposeStake function
    "function proposeStake(bytes32 _game_id) payable public",
    
    "event PlayersReady(bytes32 indexed _game_id, uint _matchmaking_time)",

    // ABI entry for joinGame function
    "function joinGame(bytes32 _game_id) public"];

const contract = new ethers.Contract(contractAddress, abi, ethers.provider.getSigner());
const txRet = await contract.createGame(
  "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // No specific opponent
  4, // Code length
  6, // Number of symbols
  10 // Bonus points
);

// If your receipt.logs array is empty, it indicates that
// no events were emitted during the execution of your
// transaction. This is common for transactions that modify
// state but don't emit any events. In this case, if you want
// to get the return value of a function like createGame,
// you would need to use a call instead of a transaction to
// get the return value directly, because state-changing
// transactions don't return values directly in Ethereum
// Use callStatic to get the return value

// TUTTAVIA
// When you use callStatic, the createGame function is simulated
// but not executed, meaning no state changes occur. Hence, no
// game ID is actually created on the blockchain.
const returnValue = await contract.callStatic.createGame("0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", 4, 6, 10);
console.log("Return Value:", returnValue);

// a signer represents an Ethereum account that can sign transactions and messages.
const accountsList = await ethers.getSigners();
const desiredSigner = accountsList[19]; // Change the index to select a different account
const contractWithNewSigner = contract.connect(desiredSigner);
const joinTx = await contractWithNewSigner.joinGame(returnValue);
// Wait for the transaction to be mined
await joinTx.wait();
console.log("Joined Game ID:", returnValue, "from address:", desiredSigner.address);


// To retrieve the game ID, you need to wait for the transaction
// to be mined and then read the return value from the
// transaction receipt. Here’s how you can do it:
const receipt = await joinTx.wait();
// Get the raw return data from the receipt
const returnVs = receipt.logs[0].data; // Adjust index based on the actual log position


// Define the ABI for the event
const eventAbi = [
    "event PlayersReady(bytes32 indexed gameId, uint256 timestamp)"
];

// Initialize an interface with the event ABI
const iface = new ethers.utils.Interface(eventAbi);

// Find the log for the PlayersReady event
const log = receipt.logs.find(log => log.topics[0] === iface.getEventTopic("PlayersReady"));

// Decode the event log
const decodedEvent = iface.decodeEventLog("PlayersReady", log.data, log.topics);

console.log("Decoded Event:", decodedEvent);
console.log("Game ID:", decodedEvent.gameId);
console.log("Timestamp:", decodedEvent.timestamp);
