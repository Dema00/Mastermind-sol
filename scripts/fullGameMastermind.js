// .load scripts/fullGameMastermind.js

const hre = require("hardhat");
const ethers = hre.ethers; // With it you should access the utils object from the ethers library

const nullAccount = "0x0000000000000000000000000000000000000000";
const accountsList = await ethers.getSigners();
const p0 = accountsList[0]; // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
const p1 = accountsList[1]; // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
const p2 = accountsList[2]; // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
const p3 = accountsList[3]; // 0x90F79bf6EB2c4f870365E785982E1f101E93b906
const p4 = accountsList[4]; // 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65

const mastermindAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const abi = [
    "function createGame(address _opponent, uint _code_len, uint _code_symbols_amt, uint _bonus) public returns (bytes32)",

    "function joinGame(bytes32 _game_id) public",
    "event PlayersReady(bytes32 indexed gameId, uint256 timestamp)",
];

const iface = new ethers.utils.Interface(abi);

const contract = new ethers.Contract(mastermindAddress, abi, ethers.provider.getSigner());

// Step 1
// Player1 create a game with opponent Player2
// Player1 create another game with casual opponent
//
contract = contract.connect(p1);
const gameIdA = await contract.createGame(p4.address, 4, 8, 10);
const receipt = await gameIdA.wait();    // Wait for the transaction to be mined
contract = contract.connect(p2);
const gameIdB = await contract.createGame(nullAccount, 4, 8, 10);
receipt = await gameIdB.wait();    // Wait for the transaction to be mined

// Step 2
// Player2 join the game
// 
contract = contract.connect(p2);
const joinA = await contract.joinGame(gameIdA);
receipt = await joinA.wait();    // Wait for the transaction to be mined
const log = receipt.logs.find(log => log.topics[0] === iface.getEventTopic("PlayersReady"));    // Find the log for the PlayersReady event
const decodedData = iface.decodeEventLog("PlayersReady", log.data, log.topics);    // Decode the event log
