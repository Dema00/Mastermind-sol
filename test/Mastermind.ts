import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { time, loadFixture, setBalance } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { AddressLike, Contract, ContractMethodArgs, ContractTransactionReceipt, ContractTransactionResponse, EventLog, FeeData, Filter, JsonRpcProvider, Listener, Log } from "ethers";
import { TypeChainEthersContractByName } from "@nomicfoundation/hardhat-ignition-ethers/dist/src/ethers-ignition-helper";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TypedContractEvent, TypedContractMethod } from "../typechain-types/common";
import { Mastermind } from "../typechain-types";
import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";
import { match } from "assert";
import { connect } from "http2";
import { getRandomValues } from "crypto";
import { groupEnd } from "console";

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
    // progress fixture
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

    async function gameRandomFixture() {
        const { creator, opponent, griefer, manager } = await loadFixture(deployMastermindFixture);

        // Create a game
        const receipt = await creator.execFunction("createGame",[
            hre.ethers.ZeroAddress,
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
            ]
        );

        const gameId = findEvent(receipt, "GameCreated").args?._game_id;

        return { creator, opponent, griefer, manager, gameId };
    }

    async function gameFixedFixture() {
        const { creator, opponent, griefer, manager} = await loadFixture(deployMastermindFixture);

        const receipt = await creator.execFunction("createGame",[
            opponent.address,
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
            ]
        );

        const gameId = findEvent(receipt, "GameCreated").args._game_id;

        return { creator, opponent, griefer, manager, gameId,};
    }

    // progress fixture
    async function GameCreatedFixture() {
        const { creator, opponent, griefer, manager } = await loadFixture(deployMastermindFixture);

        const receipt = await creator.execFunction("createGame",[
            hre.ethers.ZeroAddress,
            4, // Code length
            8, // Number of symbols
            10 // Bonus points
            ]
        );

        const gameId = findEvent(receipt, "GameCreated").args._game_id;

        await opponent.execFunction("joinGame",[gameId]);

        return { creator, opponent, gameId, manager, griefer };
    }

    // progress fixture
    async function inGameFixture() {
        const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

        const stakeAmount = hre.ethers.parseEther("10.0");
        await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
        const receipt = await opponent.execFunction("proposeStake",[gameId], {value: stakeAmount});
        const creator_first_breaker = findEvent(receipt, "GameStart").args._creator_is_first_breaker;

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker };
    }

    // progress fixture
    async function inGameHashSetFixture() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker } = await loadFixture(inGameFixture);

            const code = "0x01020304000000000000000000000000";
            const salt = "0x10000001"
            const codeHash = hre.ethers.solidityPackedKeccak256(["bytes16","bytes4"],[code,salt]);
            let receipt;
            if (creator_first_breaker){
                receipt = await opponent.execFunction("setCodeHash",[gameId, codeHash]);
            } else {
                receipt = await creator.execFunction("setCodeHash",[gameId, codeHash]);
            }
            const curr_turn = findEvent(receipt, "SecretSet").args._turn_num;

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    async function inGameCorrectGuess() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpGuess2 = "0x01020304000000000000000000000000";
        const tmpFeeedback = "0x0003";
        const tmpFeeedback2 = "0x0400";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 5; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await creator.execFunction("guess",[gameId, tmpGuess2]);
            await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback2]);
        }else{
            for (let i = 0; i < 5; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await opponent.execFunction("guess",[gameId, tmpGuess2]);
            await creator.execFunction("giveFeedback",[gameId, tmpFeeedback2]);
        }
        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    // progress fixture
    async function inGameRevealing() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpFeeedback = "0x0003";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
        }
        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    // il primo breaker indovina dopo 7 sbagli, l'altro non indovina mai (PUNTEGGIO )
    async function inGameCompetitiveGame() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpGuess2 = "0x01020304000000000000000000000000";
        const tmpFeeedback = "0x0003";
        const tmpFeeedback2 = "0x0400";
        const tmpCorrCode = "0x01020304000000000000000000000000";
        const tmpSalt = "0x10000001";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
            for (let i = 0; i < 7; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await creator.execFunction("guess",[gameId, tmpGuess2]);
            await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback2]);
            await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
        }else{
            for (let i = 0; i < 7; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await opponent.execFunction("guess",[gameId, tmpGuess2]);
            await creator.execFunction("giveFeedback",[gameId, tmpFeeedback2]);
            await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
        }

        // We can increase the time in Hardhat Network by t_disp(hardcodec)
        const futureTime = (await time.latest()) + 60;
        await time.increaseTo(futureTime);
        
        const code2 = "0x02020202000000000000000000000000";
        const salt = "0x20000002"
        const codeHash = hre.ethers.solidityPackedKeccak256(["bytes16","bytes4"],[code2,salt]);
        let receipt;
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
            receipt = await creator.execFunction("setCodeHash",[gameId, codeHash]);
        } else {
            receipt = await opponent.execFunction("setCodeHash",[gameId, codeHash]);
        }
        const new_turn = findEvent(receipt, "SecretSet").args._turn_num;
        
        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuessTurn2 = "0x04030205000000000000000000000000";
        const tmpFeeedbackTurn2 = "0x0003";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuessTurn2]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedbackTurn2]);
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuessTurn2]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedbackTurn2]);
            }
        }

        const tmpCorrCodeTurn2 = "0x02020202000000000000000000000000";
        const tmpSalt2 = "0x20000002";

        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)
            await opponent.execFunction("revealCode",[gameId, tmpCorrCodeTurn2, tmpSalt2]);
        else
            await creator.execFunction("revealCode",[gameId, tmpCorrCodeTurn2, tmpSalt2]);
        
        // We can increase the time in Hardhat Network by t_disp(hardcoded)
        const futureTime2 = (await time.latest()) + 60;
        await time.increaseTo(futureTime2);

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker };
    }

    // il primo player non indovina mai, l'altro non indovina mai
    async function inGameVeryCompetitiveGame() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpGuess2 = "0x01020304000000000000000000000000";
        const tmpFeeedback = "0x0003";
        const tmpFeeedback2 = "0x0400";
        const tmpCorrCode = "0x01020304000000000000000000000000";
        const tmpSalt = "0x10000001";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
        }

        // We can increase the time in Hardhat Network by t_disp(hardcodec)
        const futureTime = (await time.latest()) + 60;
        await time.increaseTo(futureTime);
        
        const code2 = "0x02020202000000000000000000000000";
        const salt = "0x20000002"
        const codeHash = hre.ethers.solidityPackedKeccak256(["bytes16","bytes4"],[code2,salt]);
        let receipt;
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
            receipt = await creator.execFunction("setCodeHash",[gameId, codeHash]);
        } else {
            receipt = await opponent.execFunction("setCodeHash",[gameId, codeHash]);
        }
        const new_turn = findEvent(receipt, "SecretSet").args._turn_num;
        
        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuessTurn2 = "0x04030205000000000000000000000000";
        const tmpFeeedbackTurn2 = "0x0003";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuessTurn2]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedbackTurn2]);
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuessTurn2]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedbackTurn2]);
            }
        }

        const tmpCorrCodeTurn2 = "0x02020202000000000000000000000000";
        const tmpSalt2 = "0x20000002";

        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)
            await opponent.execFunction("revealCode",[gameId, tmpCorrCodeTurn2, tmpSalt2]);
        else
            await creator.execFunction("revealCode",[gameId, tmpCorrCodeTurn2, tmpSalt2]);
        
        // We can increase the time in Hardhat Network by t_disp(hardcoded)
        const futureTime2 = (await time.latest()) + 60;
        await time.increaseTo(futureTime2);

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker };
    }

    // progress fixture
    async function inGameDisputeTime() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

            // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione si ADD da documntare nella relazione e gestito dal client
            const tmpCorrCode = "0x01020304000000000000000000000000";
            const tmpSalt = "0x10000001";

            if (creator_first_breaker)
                await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
            else
                await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

            return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    async function inGameCheatRevealing() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpFeeedback = "0x0000";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
        }
        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    async function inGameCheatDisputeTime() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameCheatRevealing);

            const tmpCorrCode = "0x01020304000000000000000000000000";
            const tmpSalt = "0x10000001";

            if (creator_first_breaker)
                await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
            else
                await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

            return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    // progress fixture
    async function inGameSecondTurn() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

            // We can increase the time in Hardhat Network by t_disp(hardcodec)
            const futureTime = (await time.latest()) + 60;
            await time.increaseTo(futureTime);

            return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    // progress fixture
    async function inGameSecondBreakerTurn() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameSecondTurn);

        const code2 = "0x02020202000000000000000000000000";
        const salt = "0x20000002"
        const codeHash = hre.ethers.solidityPackedKeccak256(["bytes16","bytes4"],[code2,salt]);
        let receipt;
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
            receipt = await creator.execFunction("setCodeHash",[gameId, codeHash]);
        } else {
            receipt = await opponent.execFunction("setCodeHash",[gameId, codeHash]);
        }
        const new_turn = findEvent(receipt, "SecretSet").args._turn_num;

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 };
    }

    // progress fixture
    async function inGameEnding() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

        // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpFeeedback = "0x0003";
        const corrGuess = "0x02020202000000000000000000000000";
        const corrFeedback = "0x0400";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 9; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await creator.execFunction("guess",[gameId, corrGuess]);
            await opponent.execFunction("giveFeedback",[gameId, corrFeedback]);
        }else{
            for (let i = 0; i < 9; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
            }
            await opponent.execFunction("guess",[gameId, corrGuess]);
            await creator.execFunction("giveFeedback",[gameId, corrFeedback]);
        }

        const tmpCorrCode = "0x02020202000000000000000000000000";
        const tmpSalt = "0x20000002";

        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)
            await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
        else
            await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 };
    }

    // progress fixture
    async function inGameOver() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameEnding);

        // We can increase the time in Hardhat Network by t_disp(hardcoded)
        const futureTime = (await time.latest()) + 60;
        await time.increaseTo(futureTime);

        // is not important who call it (generally the winner), he must just be part of the game
        let receipt;
        if (1)
            receipt = await opponent.execFunction("claimReward",[gameId]);
        else
            receipt = await creator.execFunction("claimReward",[gameId]);

        const winner = findEvent(receipt, "RewardClaimed").args._claimer;

        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2, winner };
    }
    
    async function notEmptyStackFixture() {
        const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

        const stakeAmountA = hre.ethers.parseEther("10.0");
        const stakeAmountB = hre.ethers.parseEther("100.0");
        await creator.execFunction("proposeStake",[gameId], {value: stakeAmountA});
        await opponent.execFunction("proposeStake",[gameId], {value: stakeAmountB});

        return { creator, opponent, gameId, manager, griefer };
    }

    it("Should deploy the contract correctly", async function () {
        const { manager } = await loadFixture(deployMastermindFixture);
        // Check if the contract is deployed by verifying the address
        expect(await manager.g.getAddress()).to.be.properAddress;
    });

    describe("Game Creation", function () {
        it("Should create a game and emit GameCreated event", async function () {
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

        it("Should revert with the right error if define the opponent as itself", async function () {
            const { manager, creator } = await loadFixture(deployMastermindFixture);

            await expect(creator.execFunction("createGame",[
                creator.address, // Specific opponent
                4, // Code length
                8, // Number of symbols
                10 // Bonus points
            ])).to.be.revertedWith("The opponent cannot be the game creator");
        });

        it("Should revert with the right error if code lenght exceeds", async function () {
            const { manager, creator } = await loadFixture(deployMastermindFixture);

            await expect(creator.execFunction("createGame",[hre.ethers.ZeroAddress,17,8,10])).to.be.revertedWith("The code cannot be longer than 16");
        });

        it("Should revert with the right error if number of symbols exceeds", async function () {
            const { manager, creator } = await loadFixture(deployMastermindFixture);

            await expect(creator.execFunction("createGame",[hre.ethers.ZeroAddress,4,41,10])).to.be.revertedWith("The code cannot have more than 40 colors");
        });
    });
    describe("Join Game", function () {
        it("Should allow a random player to join a game and emit PlayersReady event", async function () {
            const { manager, griefer, gameId } = await loadFixture(gameRandomFixture);

            // Join the game
            const receipt = await griefer.execFunction("joinGame",[gameId]);
            const joinEvent = findEvent(receipt, "PlayersReady");
            expect(joinEvent).to.not.be.undefined;
        });

        it("Should allow selected player to join the game and emit PlayersReady event", async function () {
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
            await manager.test("GameStart", (_game_id, first_breaker) => {
                expect(_game_id).to.equal(gameId);
                expect(first_breaker).to.be.oneOf([true, false]);
            });
        });

        //TODO aggiungi evento per fare emit StakeSent, come sopra ma quando il gioco piu avanti caricando un fixture di in un momento a caso ADD dovrebbe andare gia ma non ho modo di andare nel branch

        it("Should handle stake failing and emit StakeFailed event with the failing value", async function () {
            const { manager, creator, opponent, gameId } = await loadFixture(GameCreatedFixture);
            
            await creator.execFunction("proposeStake",[gameId], {value: hre.ethers.parseEther("1.0") });
            await opponent.execFunction("proposeStake",[gameId], { value: hre.ethers.parseEther("2.0") });

            await manager.test("StakeFailed", (_game_id, _opp_stake) => {
                expect(_game_id).to.equal(gameId);
                expect(_opp_stake).to.equal(hre.ethers.parseEther("2.0"));
            });
        });
        
        it("Should revert with the right error if wanna stack on non existing game", async function () {
            const { gameId, manager, creator, opponent} = await loadFixture(GameCreatedFixture);

            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");
            const invalidGameId = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming this game ID does not exist

            await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await expect(opponent.execFunction("proposeStake",[invalidGameId], {value: stakeAmount})).to.be.revertedWith("[Internal Error] Supplied Game does not exist");
        });

        it("Should revert with the right error if wanna stack on non staking game", async function () {
            const { gameId, manager, creator, opponent} = await loadFixture(GameCreatedFixture);

            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");

            await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await opponent.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await expect(opponent.execFunction("proposeStake",[gameId], {value: stakeAmount})).to.be.revertedWith("Game not in staking phase");
        });

        it("Should revert with the right error if outsider player wanna stack on the game", async function () {
            const { gameId, griefer, creator, opponent} = await loadFixture(GameCreatedFixture);

            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");

            await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await expect(griefer.execFunction("proposeStake",[gameId], {value: stakeAmount})).to.be.revertedWith("Sender not part of game");
        });

        it("Should revert with the right error if wanna stack on non staking game", async function () {
            const { gameId, manager, creator, opponent} = await loadFixture(GameCreatedFixture);

            // Propose a stake by the creator
            const stakeAmount = hre.ethers.parseEther("1.0");

            await expect(opponent.execFunction("proposeStake",[gameId], {value: stakeAmount})).to.be.revertedWith("Not message sender staking turn");
            await creator.execFunction("proposeStake",[gameId], {value: stakeAmount});
            await expect(creator.execFunction("proposeStake",[gameId], {value: stakeAmount})).to.be.revertedWith("Not message sender staking turn");
        });
    });

    describe("In Game Management", function () {
        describe("-> function setCodeHash", function () {
            it("Should allow setting the code", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker } = await loadFixture(inGameFixture);
                // Set code hash
                const tmpCodeHash = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense

                if (creator_first_breaker)
                    await opponent.execFunction("setCodeHash",[gameId, tmpCodeHash]);
                else
                    await creator.execFunction("setCodeHash",[gameId, tmpCodeHash]);

                await manager.test("SecretSet", (_game_id, curr_turn) => {
                    expect(_game_id).to.equal(gameId);
                    expect(curr_turn).to.not.be.undefined;
                });
            });

            it("Should allow setting the code for the second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameSecondTurn);
                // Set code hash
                const tmpCodeHash = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
                    await creator.execFunction("setCodeHash",[gameId, tmpCodeHash]);
                }
                else{
                    await opponent.execFunction("setCodeHash",[gameId, tmpCodeHash]);
                }

                await manager.test("SecretSet", (_game_id, _curr_turn) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_curr_turn).to.equal(curr_turn + 1n);
                });
            });

            it("Should revert with the right error if wanna set the code but is not your turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker } = await loadFixture(inGameFixture);
                // Set code hash
                const tmpCodeHash = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense

                if (creator_first_breaker)
                await expect(creator.execFunction("setCodeHash",[gameId, tmpCodeHash])).to.be.revertedWith("Cannot set code during opponent's turn");
                else
                await expect(opponent.execFunction("setCodeHash",[gameId, tmpCodeHash])).to.be.revertedWith("Cannot set code during opponent's turn");
            });

            it("Should revert with the right error if wanna set the code on a non member game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameFixture);
                // Set code hash
                const tmpCodeHash = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense
                await expect(griefer.execFunction("setCodeHash",[gameId, tmpCodeHash])).to.be.revertedWith("Sender not part of game");
            });
        
            it("Should revert with the right error if wanna set the code on a non existing game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameFixture);

                const tmpGame = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense
                const tmpCodeHash = "0x1000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense
                await expect(griefer.execFunction("setCodeHash",[tmpGame, tmpCodeHash])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if wanna set the code twice", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameFixture);

                const tmpCodeHash = hre.ethers.id("code"); // Assuming that this make sense
                if (creator_first_breaker) {
                    await opponent.execFunction("setCodeHash",[gameId, tmpCodeHash]);
                    await expect(opponent.execFunction("setCodeHash",[gameId, tmpCodeHash])).to.be.revertedWith("Wrong turn state");
                } else {
                    await creator.execFunction("setCodeHash",[gameId, tmpCodeHash]);
                    await expect(creator.execFunction("setCodeHash",[gameId, tmpCodeHash])).to.be.revertedWith("Wrong turn state");
                }
            });
        });
        
        describe("-> function guess", function () {
            it("Should allow guessing the code from the breaker", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
        
            });

            it("Should allow guessing the code from the breaker of second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(new_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
            });

            it("Should revert with the right error if wanna guess the code but is not your turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);
                // Set guess code
                const tmpGuess = "0x10000000000000000000000000000000"; // Assuming that this make sense

                // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Not your guessing turn");
                else
                    await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Not your guessing turn");
            });

            it("Should revert with the right error if wana guess but the game is in another game phase", async function () {
                const { creator, opponent, griefer, manager, gameId } = await loadFixture(GameCreatedFixture);
                // Set guess code
                const tmpGuess = "0x10000000000000000000000000000000"; // Assuming that this make sense

                await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Cannot advance game not in playing state");
            });

            it("Should revert with the right error if wanna guess the code on a non member game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);
                // Set code hash
                const tmpGuess = "0x10000000000000000000000000000000"; // Assuming that this make sense
                await expect(griefer.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Sender not part of game");
            });
        
            it("Should revert with the right error if wanna guess the code on a non existing game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                const tmpGame = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense
                const tmpGuess = "0x10000000000000000000000000000000"; // Assuming that this make sense
                await expect(griefer.execFunction("guess",[tmpGame, tmpGuess])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if wanna guess the code twice", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                const tmpGuess = "0x10000000000000000000000000000000"; // Assuming that this make sense
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker) {
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Turn not in guessing state");
                } else {
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("Turn not in guessing state");
                }
            });
        });

        describe("-> function giveFeedback", function () {
            it("Should allow the maker feedback the breaker guess", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback = "0x0003";

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                else
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);

                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
            });

            it("Should allow feedback the code from the maker of second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";
                const tmpFeeedback = "0x0000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                }else{
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                }
                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(new_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
            });

            it("Should allow feedback the code from the maker of second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";
                const tmpFeeedback = "0x0000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                }else{
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                }
                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(new_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
            });

            it("Should revert with the right error if wanna feedback but is not your turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback = "0x0003";

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await expect(creator.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Not your feedback turn");
                else
                    await expect(opponent.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Not your feedback turn");
            });

            it("Should revert with the right error if wanna feedback on a non member game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback = "0x0103";

                await expect(griefer.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Sender not part of game");
            });
        
            it("Should revert with the right error if wanna feedback on a non existing game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                const tmpGame = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Assuming that this make sense
                const tmpFeeedback = "0x0103";
                await expect(griefer.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if wanna feedback twice", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback = "0x0003";

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    await expect(opponent.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Turn not in giving_feedback state");
                } else {
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    await expect(creator.execFunction("giveFeedback",[gameId, tmpFeeedback])).to.be.revertedWith("Turn not in giving_feedback state");
                }
            });

            it("Should go in the right game state if submit different feedback for the same guess", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback = "0x0003";

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                else
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);

                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
                const tmpGuess2 = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess2]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess2]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess_amt, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess2);
                });
                // Giving feedback back as CC-NC
                const tmpFeeedback2 = "0x0100";

                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback2]);
                else
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback2]);

                await manager.test("GameWinner", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);

                    if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                        expect(_winner).to.equal(creator.address); 
                    else
                        expect(_winner).to.equal(opponent.address);
                });
            });
        });

        describe("-> function revealCode", function () {
            it("Should allow the maker to reveal the code", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x10000001";

                if (creator_first_breaker)
                    await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
                else
                    await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

                await manager.test("TurnOver", (_game_id, _turn_num, _code_sol) => {
                    expect(_game_id).to.equal(gameId);
                    expect(curr_turn).to.equal(_turn_num);
                    expect(tmpCorrCode).to.equal(_code_sol);
                });
            });

            it("Should let win the right player if revealed code not match the hash", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x01000300";

                if (creator_first_breaker)
                    await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
                else
                    await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

                await manager.test("GameWinner", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);

                    if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                        expect(_winner).to.equal(creator.address); 
                    else
                        expect(_winner).to.equal(opponent.address);
                });
            });

            //TODO una tecnica per non perdere la partita puo essede di dire all'avversario che ha indovinato(anche se non e' vero) per evitare il code reveal e la dispute
            it("Should allow reveal the code when last feedback is 'all match'", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameCorrectGuess);

                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x10000001";
        
                // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)
                    await expect(opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.not.be.reverted;
                else
                    await expect(creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.not.be.reverted;
            });
        
            it("Should revert with the right error if caller is not part of the game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x01020300";

                await expect(griefer.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if revealed code is called by the breaker and not the maker", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x01000004";
                

                if (creator_first_breaker){
                    await expect(creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.be.revertedWith("Message sender is not the codemaker");
                }
                else {
                    await expect(opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.be.revertedWith("Message sender is not the codemaker");
                }
            });
        });

        describe("-> function claimReward", function () {
            it("Should allow player to claim the funds to later be withdrawable", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameEnding);

                // We can increase the time in Hardhat Network by t_disp(hardcoded)
                const futureTime = (await time.latest()) + 60;
                await time.increaseTo(futureTime);

                // is not important who call it (generally the winner), he must be part of the game
                if (1)
                    await opponent.execFunction("claimReward",[gameId]);
                else
                    await creator.execFunction("claimReward",[gameId]);

                await manager.test("RewardClaimed", (_game_id, _claimer) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_claimer).to.be.oneOf([opponent.address, creator.address]);
                });
            });

            it("Should let claim the reward if the opponent did not reply to the AFK accuse in time", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";
                const tmpFeeedback = "0x0003";

                if (creator_first_breaker){
                    await opponent.execFunction("accuseAFK",[gameId]);
                    //We can increase the time in Hardhat Network by t_disp(hardcodec)
                    const futureTime = (await time.latest()) + 360;
                    await time.increaseTo(futureTime);

                    await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                    // is not important who call it (generally the winner), he must be part of the game
                    await opponent.execFunction("claimReward",[gameId]);
                    await manager.test("RewardClaimed", (_game_id, _claimer) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_claimer).to.equal(opponent.address);
                    });
                }else{
                    await creator.execFunction("accuseAFK",[gameId]);
                    //We can increase the time in Hardhat Network by t_disp(hardcodec)
                    const futureTime = (await time.latest()) + 360;
                    await time.increaseTo(futureTime);

                    await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                    // is not important who call it (generally the winner), he must be part of the game
                    await creator.execFunction("claimReward",[gameId]);
                    await manager.test("RewardClaimed", (_game_id, _claimer) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_claimer).to.equal(creator.address);
                    });
                }
            });

            it("Should set the correct winner after a competitive game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameCompetitiveGame);

                    // is not important who call it (generally the winner), he must be part of the game
                    await opponent.execFunction("claimReward",[gameId]);
                    await manager.test("RewardClaimed", (_game_id, _claimer) => {
                        expect(_game_id).to.equal(gameId);
                        if (creator_first_breaker)
                            expect(_claimer).to.equal(creator.address);
                        else
                            expect(_claimer).to.equal(opponent.address);
                    });
            });

            it("Should set the correct winner after no one guess correctly", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameVeryCompetitiveGame);

                    // is not important who call it (generally the winner), he must be part of the game
                    await opponent.execFunction("claimReward",[gameId]);
                    await manager.test("RewardClaimed", (_game_id, _claimer) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_claimer).to.equal(hre.ethers.ZeroAddress);
                    });
            });

            it("Should revert with the right error if wanna claim reward twice", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameEnding);

                // We can increase the time in Hardhat Network by t_disp(hardcoded)
                const futureTime = (await time.latest()) + 60;
                await time.increaseTo(futureTime);

                // is not important who call it (generally the winner), he must be part of the game
                await opponent.execFunction("claimReward",[gameId]);
                // reverted with 'Sender not part of game' because after first call the game is deleted
                await expect(creator.execFunction("claimReward",[gameId])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if wanna claim reward during dispute time", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameEnding);

                await expect(creator.execFunction("claimReward",[gameId])).to.be.revertedWith("The reward cannot be claimed yet");
                await expect(opponent.execFunction("claimReward",[gameId])).to.be.revertedWith("The reward cannot be claimed yet");
            });

            it("Should revert with the right error if wanna claim reward befor it is possible", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                await expect(creator.execFunction("claimReward",[gameId])).to.be.revertedWith("Cannot get winner while game is not completed");
                await expect(opponent.execFunction("claimReward",[gameId])).to.be.revertedWith("Cannot get winner while game is not completed");
            });
        });

        describe("-> function dispute", function () {
            it("Should let dispute the breaker and set the right turn winner (with a good feedback)", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                const tmpGuess = "0x04030205000000000000000000000000";  //the dispute is pointless, the feedback was right

                if (creator_first_breaker)
                    await creator.execFunction("dispute",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("dispute",[gameId, tmpGuess]);

                await manager.test("disputeSent", (_game_id, _sender) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_sender).to.not.be.undefined;
                });
                if (creator_first_breaker){
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(opponent.address);
                    });    
                } else {
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(creator.address);
                    });
                }
            });

            it("Should let dispute the breaker and set the right turn winner (with a bad feedback)", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameCheatDisputeTime);

                const tmpGuess = "0x04030205000000000000000000000000";  //the dispute is correct, the feedback was wrong

                if (creator_first_breaker)
                    await creator.execFunction("dispute",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("dispute",[gameId, tmpGuess]);

                await manager.test("disputeSent", (_game_id, _sender) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_sender).to.not.be.undefined;
                });
                if (creator_first_breaker){
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(creator.address);
                    });    
                } else {
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(opponent.address);
                    });
                }
            });

            it("Should let dispute the breaker with an invalid guess and set the other player as winner", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                const tmpGuess = "0x01020304000000000000000000000000"; //non existing guess

                if (creator_first_breaker)
                    await creator.execFunction("dispute",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("dispute",[gameId, tmpGuess]);

                await manager.test("disputeSent", (_game_id, _sender) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_sender).to.not.be.undefined;
                });

                if (creator_first_breaker){
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(opponent.address);
                    });    
                } else {
                    await manager.test("disputeWon", (_game_id, _winner) => {
                        expect(_game_id).to.equal(gameId);
                        expect(_winner).to.equal(creator.address);
                    });
                }

            });

            it("Should revert with the right error if wanna despute after the dispute time", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                // We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 60;
                await time.increaseTo(futureTime);

                const tmpGuess = "0x01020304000000000000000000000000";

                if (creator_first_breaker)
                    await expect(creator.execFunction("dispute",[gameId, tmpGuess])).to.be.revertedWith("The turn cannot be disputed");
                else
                    await expect(opponent.execFunction("dispute",[gameId, tmpGuess])).to.be.revertedWith("The turn cannot be disputed");
            });

            it("Should revert with the right error if the maker wanna dispute his self", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                const tmpGuess = "0x01020304000000000000000000000000";

                if (creator_first_breaker)
                    await expect(opponent.execFunction("dispute",[gameId, tmpGuess])).to.be.revertedWith("Message sender is not the codebreaker");
                else
                    await expect(creator.execFunction("dispute",[gameId, tmpGuess])).to.be.revertedWith("Message sender is not the codebreaker");
            });

            it("Should revert with the right error if someone wanna dispute non member game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                const tmpGuess = "0x01020304000000000000000000000000";

                await expect(griefer.execFunction("dispute",[gameId, tmpGuess])).to.be.revertedWith("Sender not part of game");
            });

        });

        describe("-> function accuseAFK", function () {
            it("Should let last turn maker accuse next turn maker of being AFK while waiting for code to be set", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                //We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 60;
                await time.increaseTo(futureTime);
                
                if (creator_first_breaker){
                    await expect(opponent.execFunction("accuseAFK",[gameId])).to.not.be.reverted;
                }else{
                    await expect(creator.execFunction("accuseAFK",[gameId])).to.not.be.reverted;
                }
            });

            it("Should let play if AFK time is not passed", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";
                const tmpFeeedback = "0x0003";

                if (creator_first_breaker){
                    await opponent.execFunction("accuseAFK",[gameId]);
                    await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.not.be.reverted;
                }else{
                    await creator.execFunction("accuseAFK",[gameId]);
                    await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.not.be.reverted;
                }
            });

            it("Should revert with the right error if wanna keep playing after time for AFK is passed", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";
                const tmpFeeedback = "0x0003";

                if (creator_first_breaker){
                    await opponent.execFunction("accuseAFK",[gameId]);
                    //We can increase the time in Hardhat Network by t_disp(hardcodec)
                    const futureTime = (await time.latest()) + 360;
                    await time.increaseTo(futureTime);
                    await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                }else{
                    await creator.execFunction("accuseAFK",[gameId]);
                    //We can increase the time in Hardhat Network by t_disp(hardcodec)
                    const futureTime = (await time.latest()) + 360;
                    await time.increaseTo(futureTime);
                    await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                }
            });

            it("Should revert with the right error if wanna accuse during the dispute (turn lock) time", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                //We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 20;  // t_disp is 60
                await time.increaseTo(futureTime);
                
                if (creator_first_breaker){
                    await expect(opponent.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Cannot accuse during turn lock time");
                }else{
                    await expect(creator.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Cannot accuse during turn lock time");
                }
            });

            it("Should revert with the right error if wanna accuse a non member game", async function () {
                const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

                await expect(griefer.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if wanna accuse befor setup the stack and start the game", async function () {
                const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

                await expect(creator.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Game has not started");
            });

            it("Should revert with the right error if player wanna accuse his self (by calling function in his turn)", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker } = await loadFixture(inGameFixture);

                if (creator_first_breaker)
                    await expect(creator.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Cannot accuse during own phase");
                else
                    await expect(opponent.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Cannot accuse during own phase");
            });

            it("Should revert with the right error if player wanna accuse twice)", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker } = await loadFixture(inGameFixture);

                if (creator_first_breaker){
                    await opponent.execFunction("accuseAFK",[gameId]);
                    await expect(opponent.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Already accused");
                }else{
                    await creator.execFunction("accuseAFK",[gameId]);
                    await expect(creator.execFunction("accuseAFK",[gameId])).to.be.revertedWith("Already accused");
                }
            });
        });
    });

    describe("Withdrawals", function () {
        it("Should increse the personal balance of the winner", async function () {
            const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2, winner } = await loadFixture(inGameOver);

            let loserProfile;
            let winnerProfile;
            if (winner === creator.address) {
                winnerProfile = creator;
                loserProfile = opponent;
            } else {
                winnerProfile = opponent;
                loserProfile = creator;
            }

            const initialBalanceW = await ethers.provider.getBalance(winnerProfile.address);
            await winnerProfile.execFunction("withdraw",[]);
            const finalBalanceW = await ethers.provider.getBalance(winnerProfile.address);

            const initialBalanceL = await ethers.provider.getBalance(loserProfile.address);
            await loserProfile.execFunction("withdraw",[]);
            const finalBalanceL = await ethers.provider.getBalance(loserProfile.address);

            expect(finalBalanceL).to.be.lt(initialBalanceL);
            expect(finalBalanceW).to.be.gt(initialBalanceW);
        });

        it("Should have stacked the amount for the game", async function () {
            const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

            const initialBalanceW = await ethers.provider.getBalance(creator.address);
            await creator.execFunction("withdraw",[]);
            const finalBalanceW = await ethers.provider.getBalance(creator.address);

            const initialBalanceL = await ethers.provider.getBalance(opponent.address);
            await opponent.execFunction("withdraw",[]);
            const finalBalanceL = await ethers.provider.getBalance(opponent.address);

            // balance not equal because we pay to use function withdraw
            expect(finalBalanceW).to.be.lte(initialBalanceW);
            expect(finalBalanceL).to.be.lte(initialBalanceL);
        });

        it("Should player get back the stack if doesn't match the opponent bet", async function () {
            const { creator, opponent, gameId, manager, griefer } = await loadFixture(notEmptyStackFixture);

            const initialBalanceW = await ethers.provider.getBalance(creator.address);
            await creator.execFunction("withdraw",[]);
            const finalBalanceW = await ethers.provider.getBalance(creator.address);

            const initialBalanceL = await ethers.provider.getBalance(opponent.address);
            await opponent.execFunction("withdraw",[]);
            const finalBalanceL = await ethers.provider.getBalance(opponent.address);

            // balance not equal because we pay to use function withdraw
            expect(finalBalanceW).to.be.gt(initialBalanceW);
            expect(finalBalanceL).to.be.gt(initialBalanceL);
        });

        it("Should let player withdrow his win in case opponent cheats in feedback", async function () {
            const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameCheatDisputeTime);

            const tmpGuess = "0x04030205000000000000000000000000";  //the dispute is correct, the feedback was wrong

            if (creator_first_breaker)
                await creator.execFunction("dispute",[gameId, tmpGuess]);
            else
                await opponent.execFunction("dispute",[gameId, tmpGuess]);

            await manager.test("disputeSent", (_game_id, _sender) => {
                expect(_game_id).to.equal(gameId);
                expect(_sender).to.not.be.undefined;
            });

            if (creator_first_breaker){
                await manager.test("disputeWon", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_winner).to.equal(creator.address);
                });

                const initialBalanceW = await ethers.provider.getBalance(creator.address);
                await creator.execFunction("withdraw",[]);
                const finalBalanceW = await ethers.provider.getBalance(creator.address);
    
                const initialBalanceL = await ethers.provider.getBalance(opponent.address);
                await opponent.execFunction("withdraw",[]);
                const finalBalanceL = await ethers.provider.getBalance(opponent.address);

                expect(finalBalanceL).to.be.lt(initialBalanceL);
                expect(finalBalanceW).to.be.gt(initialBalanceW);
            } else {
                await manager.test("disputeWon", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_winner).to.equal(opponent.address);
                });

                const initialBalanceW = await ethers.provider.getBalance(opponent.address);
                await opponent.execFunction("withdraw",[]);
                const finalBalanceW = await ethers.provider.getBalance(opponent.address);
    
                const initialBalanceL = await ethers.provider.getBalance(creator.address);
                await creator.execFunction("withdraw",[]);
                const finalBalanceL = await ethers.provider.getBalance(creator.address);

                expect(finalBalanceL).to.be.lt(initialBalanceL);
                expect(finalBalanceW).to.be.gt(initialBalanceW);
            }
        });

        it("Should let the both players claim back the stack in case of a tie", async function () {
            const { creator, opponent, griefer, manager, gameId, creator_first_breaker} = await loadFixture(inGameVeryCompetitiveGame);

                // is not important who call it (generally the winner), he must be part of the game
                await opponent.execFunction("claimReward",[gameId]);
                await manager.test("RewardClaimed", (_game_id, _claimer) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_claimer).to.equal(hre.ethers.ZeroAddress);
                });

                const initialBalanceW = await ethers.provider.getBalance(creator.address);
                await creator.execFunction("withdraw",[]);
                const finalBalanceW = await ethers.provider.getBalance(creator.address);
    
                const initialBalanceL = await ethers.provider.getBalance(opponent.address);
                await opponent.execFunction("withdraw",[]);
                const finalBalanceL = await ethers.provider.getBalance(opponent.address);
    
                // balance not equal because we pay to use function withdraw
                expect(finalBalanceW).to.be.gt(initialBalanceW);
                expect(finalBalanceL).to.be.gt(initialBalanceL);
    
        });

        it("Should let player withdrow (after claim rewards) if the opponent did not reply to the AFK accuse in time", async function () {
            const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

            // Plain text guess: theoretical max playable 16 code lenght with theoretical max 16*16 color
            const tmpGuess = "0x04030205000000000000000000000000";
            const tmpFeeedback = "0x0003";

            if (creator_first_breaker){
                await opponent.execFunction("accuseAFK",[gameId]);
                //We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 360;
                await time.increaseTo(futureTime);

                await expect(creator.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                // is not important who call it (generally the winner), he must be part of the game
                await opponent.execFunction("claimReward",[gameId]);
                await manager.test("RewardClaimed", (_game_id, _claimer) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_claimer).to.equal(opponent.address);
                });
                const initialBalanceW = await ethers.provider.getBalance(opponent.address);
                await opponent.execFunction("withdraw",[]);
                const finalBalanceW = await ethers.provider.getBalance(opponent.address);
    
                const initialBalanceL = await ethers.provider.getBalance(creator.address);
                await creator.execFunction("withdraw",[]);
                const finalBalanceL = await ethers.provider.getBalance(creator.address);

                expect(finalBalanceL).to.be.lt(initialBalanceL);
                expect(finalBalanceW).to.be.gt(initialBalanceW);
            }else{
                await creator.execFunction("accuseAFK",[gameId]);
                //We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 360;
                await time.increaseTo(futureTime);

                await expect(opponent.execFunction("guess",[gameId, tmpGuess])).to.be.revertedWith("You were AFK for too long");
                // is not important who call it (generally the winner), he must be part of the game
                await creator.execFunction("claimReward",[gameId]);
                await manager.test("RewardClaimed", (_game_id, _claimer) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_claimer).to.equal(creator.address);
                });
                const initialBalanceW = await ethers.provider.getBalance(creator.address);
                await creator.execFunction("withdraw",[]);
                const finalBalanceW = await ethers.provider.getBalance(creator.address);
    
                const initialBalanceL = await ethers.provider.getBalance(opponent.address);
                await opponent.execFunction("withdraw",[]);
                const finalBalanceL = await ethers.provider.getBalance(opponent.address);

                expect(finalBalanceL).to.be.lt(initialBalanceL);
                expect(finalBalanceW).to.be.gt(initialBalanceW);
            }
        });

    });
});
