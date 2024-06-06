import { expect } from "chai";
import hre from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { AddressLike, Contract, ContractMethodArgs, ContractTransactionReceipt, ContractTransactionResponse, EventLog, Filter, JsonRpcProvider, Listener, Log } from "ethers";
import { TypeChainEthersContractByName } from "@nomicfoundation/hardhat-ignition-ethers/dist/src/ethers-ignition-helper";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TypedContractEvent, TypedContractMethod } from "../typechain-types/common";
import { Mastermind } from "../typechain-types";
import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";
import { match } from "assert";
import { connect } from "http2";

function findEvent(
    receipt:  ContractTransactionReceipt | null, 
    event_name: string
) {
    return receipt?.logs.find((event) => (event as EventLog).eventName === event_name) as EventLog;
}

function findEventInGame(
    receipt:  ContractTransactionReceipt | null, 
    event_name: string,
    game_id: string
) {
    return receipt?.logs.find((event) => {
        const ev = (event as EventLog);
        ev.eventName === event_name && (ev.args?._game_id === game_id);
        return ev;
    }) as EventLog;
}

class Actor {
    g: Mastermind;
    m: ContractTestManager;
    address: AddressLike;

    constructor(game: Mastermind, actor: HardhatEthersSigner, manager: ContractTestManager) {
        this.g = game.connect(actor);
        this.m = manager;
        this.address = actor.address;
    }

    async execFunction<A extends any[]>(
        name: string,
        args: ContractMethodArgs<A>,
        prop: {} = {}
    ) {
        const response = await (await this.g.getFunction(name).call([],...args,prop) as ContractTransactionResponse).wait();
        this.m.tx = response;
        return response;
    }
}

class ContractTestManager {
    g: Mastermind;
    p: HardhatEthersProvider;
    tx: any;

    constructor(game: Mastermind, game_address: string) {
        this.g = game;
        this.p = hre.ethers.provider;
        this.tx = {};
    }

    newActor(actor : HardhatEthersSigner) {
        return new Actor(this.g, actor, this) as Actor;
    }

    async test(event_name: string, listener: Listener) {
        const event = findEvent(this.tx,event_name);
        listener(...event.args);
    }
}

describe("Mastermind", function () {
    
    async function deployMastermindFixture() {
        const Mastermind = await hre.ethers.getContractFactory("Mastermind");
        // Get the players from the account list
        const [owner, p1, p2, p3, p4, ...others] = await hre.ethers.getSigners();

        const mastermind = await Mastermind.deploy();
        await mastermind.waitForDeployment();

        const manager = new ContractTestManager(mastermind, await mastermind.getAddress());

        const creator = manager.newActor(p1);
        const opponent = manager.newActor(p2);
        const griefer = manager.newActor(p3);

        return { creator, opponent, griefer, manager };
    }

    async function gameFixedFixture() {
        const { creator, opponent, griefer, manager} = await loadFixture(deployMastermindFixture);

        const receipt = await creator.execFunction("createGame",[
            opponent.address,
            4, 
            8, 
            10]
        );

        const gameId = findEvent(receipt, "GameCreated").args._game_id;

        return { creator, opponent, griefer, manager, gameId,};
    }

    async function GameCreatedFixture() {
        const { creator, opponent, griefer, manager } = await loadFixture(deployMastermindFixture);

        const receipt = await creator.execFunction("createGame",[
            hre.ethers.ZeroAddress,
            4, 
            8, 
            10]
        );

        const gameId = findEvent(receipt, "GameCreated").args._game_id;

        await opponent.execFunction("joinGame",[gameId]);

        return { creator, opponent, gameId, manager };
    }

    async function gameRandomFixture() {
        const { creator, opponent, griefer, manager } = await loadFixture(deployMastermindFixture);

        // Create a game
        const receipt = await creator.execFunction("createGame",[
            hre.ethers.ZeroAddress,
            4, 
            8, 
            10]
        );

        const gameId = findEvent(receipt, "GameCreated").args?._game_id;

        return { creator, opponent, griefer, manager, gameId };
    }

    it("should deploy the contract correctly", async function () {
        const { manager } = await loadFixture(deployMastermindFixture);
        // Check if the contract is deployed by verifying the address
        expect(await manager.g.getAddress()).to.be.properAddress;
    });

    describe("Game Creation", function () {
        it("should create a game and emit GameCreated event", async function () {
            const { manager, creator } = await loadFixture(deployMastermindFixture);

            const receipt = await creator.execFunction("createGame",[
                hre.ethers.ZeroAddress, // No specific opponent
                4, // Code length
                8, // Number of symbols
                10 // Bonus points
            ]);
            const event = findEvent(receipt, "GameCreated");
            expect(event).to.not.be.undefined;

            const gameId = event.args._game_id;
            expect(gameId).to.not.be.undefined;
        });

        it("Should revert with the right error if called upon itself", async function () {
            const { manager, creator } = await loadFixture(deployMastermindFixture);

            expect(creator.execFunction("createGame",[
                creator.address, // Specific opponent
                4, // Code length
                8, // Number of symbols
                10 // Bonus points
            ])).to.be.revertedWith("The opponent cannot be the game creator");
        });
    });
    describe("Join Game", function () {

        it("should allow a random player to join a game and emit PlayersReady event", async function () {
            const { manager, griefer, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            const receipt = await griefer.execFunction("joinGame",[gameId]);
            const joinEvent = findEvent(receipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
        });

        it("should allow selected player to join the game and emit PlayersReady event", async function () {
            const { manager, creator, opponent, gameId } = await loadFixture(gameFixedFixture);

            // Join the game
            const receipt = await opponent.execFunction("joinGame",[gameId]);
            const joinEvent = findEvent(receipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
        });

        it("Should revert with the right error if called with creator as opponent", async function () {
            const { manager, creator, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            await expect(creator.execFunction("joinGame",[gameId])).to.be.revertedWith("[Internal Error] Creator and opponent cannot be the same");
        });
        
        it("Should revert with the right error if called by the non selected opponent", async function () {
            const { griefer, gameId } = await loadFixture(gameFixedFixture);

            // Join the game
            await expect(griefer.execFunction("joinGame",[gameId])).to.be.revertedWith("Opponent cannot join Game");
        });

        it("Should revert with the right error if someone else wants to join", async function () {
            const { manager, opponent, griefer, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            const receipt = await opponent.execFunction("joinGame",[gameId]);
            const joinEvent = findEvent(receipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
            // Join again the game
            await expect(griefer.execFunction("joinGame",[gameId])).to.be.revertedWith("[Internal Error] Supplied Game cannot accept opponents");
        });

        it("Should revert with the right error if wanna join a non existing game", async function () {
            const { manager, griefer } = await loadFixture(gameRandomFixture);

            const invalidGameId = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming this game ID does not exist
            // Try join the game
            await expect(griefer.execFunction("joinGame",[invalidGameId])).to.be.revertedWith("[Internal Error] Supplied Game does not exist");
        });

        it("Should join a game in queue when supplied with address 0", async function () {
            const { manager, griefer, gameId } = await loadFixture(gameRandomFixture);
            const nullGameId = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Assuming this game ID does not exist
            griefer.execFunction("joinGame",[nullGameId]);

            await manager.test("PlayersReady", (_game_id, _time) => {
                expect(_game_id).to.be.equal(gameId);
            });
        });
    });

    describe("Lobby Management", function () {

        it("Should handle staking and emit StakeSuccessful event", async function () {
            const { gameId, manager, creator, opponent} = await loadFixture(GameCreatedFixture);


            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");
            await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await opponent.execFunction("proposeStake",[gameId], {value: stakeAmount});

            await manager.test("StakeSuccessful", (_game_id, _stake) => {
                expect(_game_id).to.equal(gameId);
                expect(_stake).to.equal(hre.ethers.parseEther("1.0"));
            });
        });

        it("Should handle stake failing and emit StakeFailed event with the failing value", async function () {
            const { manager, creator, opponent, gameId } = await loadFixture(GameCreatedFixture);
            
            await creator.execFunction("proposeStake",[gameId], {value: hre.ethers.parseEther("1.0") });
            await opponent.execFunction("proposeStake",[gameId], { value: hre.ethers.parseEther("2.0") });

            await manager.test("StakeFailed", (_game_id, _opp_stake) => {
                expect(_game_id).to.equal(gameId);
                expect(_opp_stake).to.equal(hre.ethers.parseEther("2.0"));
            });
            
            /*const stakeEvent = findEventInGame(receipt, "StakeFailed", gameId);
            expect(stakeEvent.args._game_id).to.equal(gameId);
            expect(stakeEvent.args._opp_stake).to.equal(hre.ethers.parseEther("2.0"));*/
            
        });
    });

    // it("should allow setting and guessing the code", async function () {
    //     const { mastermind, p1, gameId } = await loadFixture(gameCreatedFixture);

    //     // Propose a stake by the creator
    //     const stakeAmount = hre.ethers.utils.parseEther("1.0");
    //     await mastermind.proposeStake(gameId, { value: stakeAmount });
    //     await mastermind.connect(p1).proposeStake(gameId, { value: stakeAmount });

    //     // Set code hash
    //     const codeHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("1234"));
    //     await mastermind.setCodeHash(gameId, codeHash);

    //     // Make a guess
    //     const guess = hre.ethers.utils.formatBytes32String("1234");
    //     const guessTx = await mastermind.connect(p1).guess(gameId, guess);
    //     await guessTx.wait();
    // });

    // it("should handle feedback and game flow", async function () {
    //     const { mastermind, p1, gameId } = await loadFixture(gameCreatedFixture);

    //     // Propose a stake by the creator
    //     const stakeAmount = hre.ethers.utils.parseEther("1.0");
    //     await mastermind.proposeStake(gameId, { value: stakeAmount });
    //     await mastermind.connect(p1).proposeStake(gameId, { value: stakeAmount });

    //     // Set code hash
    //     const codeHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("1234"));
    //     await mastermind.setCodeHash(gameId, codeHash);

    //     // Make a guess
    //     const guess = hre.ethers.utils.formatBytes32String("1234");
    //     await mastermind.connect(p1).guess(gameId, guess);

    //     // Provide feedback
    //     const feedback = "0x01"; // Some feedback value
    //     const feedbackTx = await mastermind.giveFeedback(gameId, feedback);
    //     await feedbackTx.wait();
    // });

    // it("should allow revealing the code and declaring the winner", async function () {
    //     const { mastermind, p1, gameId } = await loadFixture(gameCreatedFixture);

    //     // Propose a stake by the creator
    //     const stakeAmount = hre.ethers.utils.parseEther("1.0");
    //     await mastermind.proposeStake(gameId, { value: stakeAmount });
    //     await mastermind.connect(p1).proposeStake(gameId, { value: stakeAmount });

    //     // Set code hash
    //     const codeHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("1234"));
    //     await mastermind.setCodeHash(gameId, codeHash);

    //     // Make a guess
    //     const guess = hre.ethers.utils.formatBytes32String("1234");
    //     await mastermind.connect(p1).guess(gameId, guess);

    //     // Provide feedback
    //     const feedback = "0x01"; // Some feedback value
    //     await mastermind.giveFeedback(gameId, feedback);

    //     // Reveal code
    //     const salt = "0x1234"; // Some salt
    //     const revealCodeTx = await mastermind.revealCode(gameId, guess, salt);
    //     await revealCodeTx.wait();

    //     // Claim reward
    //     const claimRewardTx = await mastermind.claimReward(gameId);
    //     const claimRewardReceipt = await claimRewardTx.wait();
    //     const winnerEvent = claimRewardReceipt.events?.find((event: any) => event.event === "GameWinner");
    //     expect(winnerEvent).to.not.be.undefined;
    // });
});
