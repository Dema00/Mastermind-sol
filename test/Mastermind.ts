import { expect } from "chai";
import hre from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ContractTransactionReceipt, EventLog, Log } from "ethers";
import { TypeChainEthersContractByName } from "@nomicfoundation/hardhat-ignition-ethers/dist/src/ethers-ignition-helper";

describe("Mastermind", function () {
    
    async function deployMastermindFixture() {
        const Mastermind = await hre.ethers.getContractFactory("Mastermind");
        // Get the players from the account list
        const [owner, p1, p2, p3, p4, ...others] = await hre.ethers.getSigners();

        const mastermind = await Mastermind.deploy();
        await mastermind.waitForDeployment();

        return { mastermind, owner, p1, p2, p3, p4, others };
    }

    async function gameFixedFixture() {
        const { mastermind, owner, p1, p2, p3, p4, others } = await loadFixture(deployMastermindFixture);

        // Create a game
        const gameTx = await mastermind.connect(p1).createGame(
            p4.address, // Specific opponent
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
        );

        const receipt = await gameTx.wait();
        const gameId = findEvent(receipt, "GameCreated").args?._game_id;

        return { mastermind, owner, p1, p2, p3, p4, others, gameId };
    }

    async function GameCreatedFixture() {
        const { mastermind, owner, p1, p2, p3, p4, others } = await loadFixture(deployMastermindFixture);

        // Create a game
        const gameTx = await mastermind.connect(p1).createGame(
            hre.ethers.ZeroAddress, // No specific opponent
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
        );

        const receipt = await gameTx.wait();
        const gameId = findEvent(receipt, "GameCreated").args?._game_id;

        await (await mastermind.connect(p2).joinGame(gameId)).wait();

        return { mastermind, owner, p1, p2, others, gameId };
    }

    async function gameRandomFixture() {
        const { mastermind, owner, p1, p2, p3, p4, others } = await loadFixture(deployMastermindFixture);

        // Create a game
        const gameTx = await mastermind.connect(p1).createGame(
            hre.ethers.ZeroAddress, // No specific opponent
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
        );

        const receipt = await gameTx.wait();
        const gameId = findEvent(receipt, "GameCreated").args?._game_id;

        return { mastermind, owner, p1, p2, p3, p4, others, gameId };
    }

    it("should deploy the contract correctly", async function () {
        const { mastermind, owner } = await loadFixture(deployMastermindFixture);
        // Check if the contract is deployed by verifying the address
        expect(await mastermind.getAddress()).to.be.properAddress;
    });

    describe("Game Creation", function () {
        it("should create a game and emit GameCreated event", async function () {
            const { mastermind, p1 } = await loadFixture(deployMastermindFixture);

            const newGameTx = await mastermind.connect(p1).createGame(
                hre.ethers.ZeroAddress, // No specific opponent
                4, // Code length
                8, // Number of symbols
                10 // Bonus points
            );

            const receipt = await newGameTx.wait();
            const event = findEvent(receipt, "GameCreated");
            expect(event).to.not.be.undefined;

            const gameId = (event as EventLog).args._game_id;
            expect(gameId).to.not.be.undefined;
        });

        it("Should revert with the right error if called upon itself", async function () {
            const { mastermind, p1 } = await loadFixture(deployMastermindFixture);

            await expect(mastermind.connect(p1).createGame(
                p1.address, // Specific opponent
                4, // Code length
                8, // Number of symbols
                10 // Bonus points
            )).to.be.revertedWith("The opponent cannot be the game creator");
        });
    });
    describe("Join Game", function () {
        it("should allow a random player to join a game and emit PlayersReady event", async function () {
            const { mastermind, p3, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            const joinGameTx = await mastermind.connect(p3).joinGame(gameId);
            const joinReceipt = await joinGameTx.wait();
            const joinEvent = findEvent(joinReceipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
        });
        it("should allow selected player to join the game and emit PlayersReady event", async function () {
            const { mastermind, p4, gameId } = await loadFixture(gameFixedFixture);

            // Join the game
            
            const joinGameTx = await mastermind.connect(p4).joinGame(gameId);
            const joinReceipt = await joinGameTx.wait();
            const joinEvent = findEvent(joinReceipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
        });
        it("Should revert with the right error if called with creator as opponent", async function () {
            const { mastermind, p1, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            await expect(mastermind.connect(p1).joinGame(gameId)).to.be.revertedWith("[Internal Error] Creator and opponent cannot be the same");
        });
        it("Should revert with the right error if called by the non selected opponent", async function () {
            const { mastermind, p3, gameId } = await loadFixture(gameFixedFixture);

            // Join the game
            await expect(mastermind.connect(p3).joinGame(gameId)).to.be.revertedWith("Opponent cannot join Game");
        });
        it("Should revert with the right error if someone else wants to join", async function () {
            const { mastermind, p2, p4, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            const joinGameTx = await mastermind.connect(p4).joinGame(gameId);
            const joinReceipt = await joinGameTx.wait();
            const joinEvent = findEvent(joinReceipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
            // Join again the game
            await expect(mastermind.connect(p2).joinGame(gameId)).to.be.revertedWith("[Internal Error] Supplied Game cannot accept opponents");
        });
        it("Should revert with the right error if wanna join a non existing game", async function () {
            const { mastermind, p4 } = await loadFixture(gameRandomFixture);

            const invalidGameId = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming this game ID does not exist
            // Try join the game
            await expect(mastermind.connect(p4).joinGame(invalidGameId)).to.be.revertedWith("[Internal Error] Supplied Game does not exist");
        });
    });

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

    describe("Lobby Management", function () {

        it("Should handle staking and emit StakeSuccessful event", async function () {
            const { mastermind, p1, p2, gameId } = await loadFixture(GameCreatedFixture);

            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");
            await (await mastermind.connect(p1).proposeStake(gameId, { value: stakeAmount })).wait();
            const receipt = await (await mastermind.connect(p2).proposeStake(gameId, { value: stakeAmount })).wait();
            const stakeEvent = findEventInGame(receipt, "StakeSuccessful", gameId);
            expect(stakeEvent.args?._game_id).to.equal(gameId);
            expect(stakeEvent.args?._stake).to.equal(stakeAmount);
        });

        it("Should handle stake failing and emit StakeFailed event with the failing value", async function () {
            const { mastermind, p1, p2, gameId } = await loadFixture(GameCreatedFixture);
            
            await (await mastermind.connect(p1).proposeStake(gameId, { value: hre.ethers.parseEther("1.0") })).wait();
            const receipt = await (await mastermind.connect(p2).proposeStake(gameId, { value: hre.ethers.parseEther("2.0") })).wait();
            const stakeEvent = findEventInGame(receipt, "StakeFailed", gameId);
            expect(stakeEvent.args?._game_id).to.equal(gameId);
            expect(stakeEvent.args?._opp_stake).to.equal(hre.ethers.parseEther("2.0"));
            
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
