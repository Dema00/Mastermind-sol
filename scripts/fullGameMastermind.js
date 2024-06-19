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
    "function createGame(address _opponent, uint8 _code_len, uint8 _code_symbols_amt, uint _bonus) public returns(bytes32)",
    "function joinGame(bytes32 _game_id) public",
    "function proposeStake(bytes32 _game_id)payable public",
    "function withdraw() external returns (bool)",
    "function setCodeHash(bytes32 _game_id, bytes32 _code_hash) public",
    "function guess(bytes32 _game_id, bytes16 _guess) public",
    "function giveFeedback(bytes32 _game_id,bytes2 _feedback) public",
    "function revealCode(bytes32 _game_id,bytes16 _code_sol,bytes4 _salt) public",
    "function claimReward(bytes32 _game_id) public",
    "function dispute(bytes32 _game_id,bytes16 _guess) public",
    "function accuseAFK(bytes32 _game_id) public",
    
    "event GameCreated(bytes32 indexed _game_id, address indexed _game_creator)",
    "event PlayersReady(bytes32 indexed _game_id, uint _matchmaking_time)",
    "event StakeSuccessful(bytes32 indexed _game_id, uint _stake)",
    "event StakeFailed(bytes32 indexed _game_id, uint _opp_stake)",
    "event StakeSent(bytes32 indexed _game_id, uint _stake)",
    "event GameStart(bytes32 indexed _game_id, bool _creator_is_first_breaker)",
    "event SecretSet(bytes32 indexed _game_id, uint _turn_num)",
    "event GuessSent(bytes32 indexed _game_id, uint _turn_num, bytes16 _guess)",
    "event FeedbackSent(bytes32 indexed _game_id, uint _turn_num, bytes2 _feedback)",
    "event TurnOver(bytes32 indexed _game_id, uint _turn_num, bytes16 _code_sol)",
    "event GameWinner(bytes32 indexed _game_id, address _winner)",
    "event disputeSent(bytes32 indexed _game_id, address _sender)",
    "event disputeWon(bytes32 indexed _game_id, address _winner)",
    "event RewardClaimed (bytes32 indexed _game_id, address _claimer)",
];

const iface = new ethers.utils.Interface(abi);

const contract = new ethers.Contract(mastermindAddress, abi, ethers.provider.getSigner());

let tx;
let log;
let decodedData;
// Player1 create a game with opponent Player2
//
contract = contract.connect(p1);
tx = await contract.createGame(p4.address, 4, 6, 10);
const receipt = await tx.wait();    // Wait for the transaction to be mined
const gameIdA = receipt.events[0].data;
// Player3 create another game with casual opponent
//
contract = contract.connect(p3);
tx = await contract.createGame(nullAccount, 4, 6, 10);
receipt = await tx.wait();    // Wait for the transaction to be mined
const gameIdB = receipt.events[0].data;
// Player2 join the gameA
//
contract = contract.connect(p2);
tx = await contract.joinGame(gameIdA);
receipt = await tx.wait();    // Wait for the transaction to be mined
log = receipt.logs.find(log => log.topics[0] === iface.getEventTopic("PlayersReady"));    // Find the log for the PlayersReady event
console.log(decodedData = iface.decodeEventLog("PlayersReady", log.data, log.topics));    // Pront the decoded event
// Random player (Player4) join the gameB
//
contract = contract.connect(p4);
tx = await contract.joinGame(gameIdB);
receipt = await tx.wait();    // Wait for the transaction to be mined
log = receipt.logs.find(log => log.topics[0] === iface.getEventTopic("PlayersReady"));    // Find the log for the PlayersReady event
console.log(decodedData = iface.decodeEventLog("PlayersReady", log.data, log.topics));    // Pront the decoded event
