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
    "event GameReady(bytes32 _game_id)",

    "function joinGame(bytes32 _game_id) public",
    "event PlayersReady(bytes32 indexed _game_id, uint _matchmaking_time)",
];

const iface = new ethers.utils.Interface(abi);

const contract = new ethers.Contract(mastermindAddress, abi, ethers.provider.getSigner());

// Step 1
// Player1 create a game with opponent Player2
// Player1 create another game with casual opponent
//
contract = contract.connect(p1);
const gameTxA = await contract.createGame(p4.address, 4, 8, 10);
const receipt = await gameTxA.wait();    // Wait for the transaction to be mined
const gameIdA = receipt.events[0].data;

contract = contract.connect(p3);
const gameTxB = await contract.createGame(nullAccount, 4, 8, 10);
receipt = await gameTxB.wait();    // Wait for the transaction to be mined
const gameIdB = receipt.events[0].data;
// Step 2
// Player2 join the game
// 
contract = contract.connect(p4);
const joinA = await contract.joinGame(gameIdA);
receipt = await joinA.wait();    // Wait for the transaction to be mined
const log = receipt.logs.find(log => log.topics[0] === iface.getEventTopic("PlayersReady"));    // Find the log for the PlayersReady event
const decodedData = iface.decodeEventLog("PlayersReady", log.data, log.topics);    // Decode the event log
