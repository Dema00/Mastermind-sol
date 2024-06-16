import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
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

    // progress fixture
    async function inGameRevealing() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

        // TODO vero quanto sotto?
        // Plain text guess: max playable 16 code lenght with max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpFeeedback = "0x0003";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                // TODO mi serve salvare ogni singola coppia guess e feedback? no perche viene checkato ogni turno se vanno bene e la dispute c'e dopo il code reveal
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                // TODO mi serve salvare ogni singola coppia guess e feedback?
            }
        }
        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code };
    }

    // progress fixture
    async function inGameDisputeTime() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

            // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
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
    async function inGameSecondRevealing() {
        const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

        // TODO vero quanto sotto?
        // Plain text guess: max playable 16 code lenght with max 16*16 color
        const tmpGuess = "0x04030205000000000000000000000000";
        const tmpFeeedback = "0x0003";

        // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
        if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
            for (let i = 0; i < 10; i++) {
                await creator.execFunction("guess",[gameId, tmpGuess]);
                await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                // TODO mi serve salvare ogni singola coppia guess e feedback? no perche viene checkato ogni turno se vanno bene e la dispute c'e dopo il code reveal
            }
        }else{
            for (let i = 0; i < 10; i++) {
                await opponent.execFunction("guess",[gameId, tmpGuess]);
                await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                // TODO mi serve salvare ogni singola coppia guess e feedback?
            }
        }
        return { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 };
    }

    async function notEmptyStackFixture() {
        const { creator, opponent, gameId, manager, griefer } = await loadFixture(GameCreatedFixture);

        const stakeAmountA = hre.ethers.parseEther("10.0");
        const stakeAmountB = hre.ethers.parseEther("100.0");
        await creator.execFunction("proposeStake",[gameId], {value: stakeAmountA});
        await opponent.execFunction("proposeStake",[gameId], {value: stakeAmountB});

        return { creator, opponent, griefer, manager, gameId };
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

        //TODO aggiungi evento per fare emit StakeSent, come sopra ma quando il gioco piu avanti caricando un fixture di in un momento a caso

        it("Should handle stake failing and emit StakeFailed event with the failing value", async function () {
            const { manager, creator, opponent, gameId } = await loadFixture(GameCreatedFixture);
            
            await creator.execFunction("proposeStake",[gameId], {value: hre.ethers.parseEther("1.0") });
            await opponent.execFunction("proposeStake",[gameId], { value: hre.ethers.parseEther("2.0") });

            await manager.test("StakeFailed", (_game_id, _opp_stake) => {
                expect(_game_id).to.equal(gameId);
                expect(_opp_stake).to.equal(hre.ethers.parseEther("2.0"));
            });

            //TODO pending return deve essere controllato che sia aumentato, qui e in ogni StakeFailed

            /*const stakeEvent = findEventInGame(receipt, "StakeFailed", gameId);
            expect(stakeEvent.args._game_id).to.equal(gameId);
            expect(stakeEvent.args._opp_stake).to.equal(hre.ethers.parseEther("2.0"));*/            
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(curr_turn);
                    expect(_guess).to.equal(tmpGuess);
                });
        
            });

            it("Should allow guessing the code from the breaker of second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";
                const tmpFeeedback = "0x0000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }else{
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }
                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(new_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
            });

            it("Should allow feedback the code from the maker of second turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030303000000000000000000000000";
                const tmpFeeedback = "0x0000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }else{
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }
                await manager.test("FeedbackSent", (_game_id, _new_turn, _feedback) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_new_turn).to.equal(new_turn);
                    expect(_feedback).to.equal(tmpFeeedback);
                });
            });

            // TODO posso assegnare direttamente la vittoria perche se il maker onesto ok. se maker si e' sbagliato vince l'altro, ergo non importa il code reveal
            it("Should let win the breaker if the feedback means exact match", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondBreakerTurn);

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x02020202000000000000000000000000";
                const tmpFeeedback = "0x0400";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker){  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                    await opponent.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }else{
                    await opponent.execFunction("guess",[gameId, tmpGuess]);
                    await creator.execFunction("giveFeedback",[gameId, tmpFeeedback]);
                    // TODO mi serve salvare ogni singola coppia guess e feedback?
                }
                await manager.test("GameWinner", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);

                    if ((new_turn % 2n === 1n) && creator_first_breaker || (new_turn % 2n === 0n) && !creator_first_breaker)
                        expect(_winner).to.equal(creator.address); 
                    else
                        expect(_winner).to.equal(opponent.address);
                });
            });

            it("Should revert with the right error if wanna feedback but is not your turn", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameHashSetFixture);

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO vero quanto sotto?
                // Plain text guess: max playable 16 code lenght with max 16*16 color
                const tmpGuess = "0x04030205000000000000000000000000";

                // Turn set to '1n' after the SetCodeHash, if creator_first_breaker=true the odd turns are for creator player
                if ((curr_turn % 2n === 1n) && creator_first_breaker || (curr_turn % 2n === 0n) && !creator_first_breaker)  // se siamo al primo turno e non ho fatto io il codice tocca a me, se siamo al secondo turno e ho fatto io il codice tocca a me
                    await creator.execFunction("guess",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("guess",[gameId, tmpGuess]);

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                await manager.test("GuessSent", (_game_id, _new_turn, _guess) => {
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

                // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
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

            it("Should allow the second maker to reveal the code and end the game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, new_turn, code2 } = await loadFixture(inGameSecondRevealing);

                // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
                const tmpCorrCode = "0x02020202000000000000000000000000";
                const tmpSalt = "0x20000002";

                if (creator_first_breaker)
                    await creator.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);
                else
                    await opponent.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt]);

                await manager.test("TurnOver", (_game_id, _turn_num, _code_sol) => {
                    expect(_game_id).to.equal(gameId);
                    expect(new_turn).to.equal(_turn_num);
                    expect(tmpCorrCode).to.equal(_code_sol);
                });

                // We can increase the time in Hardhat Network by t_disp(hardcodec)
                const futureTime = (await time.latest()) + 60;
                await time.increaseTo(futureTime);
                // TODO test del tempo per il dispute()? cosa succede se faccio prima del tempo il claim?
                // TODO come arrivo a "Cannot get winner while game is not completed" dentro GameFunction.getWinner?

                await manager.test("GameWinner", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_winner).to.be.oneOf([opponent.address, creator.address]);
                });
            });

            it("Should let win the right player if revealed code not match the hash", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
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

            it("Should revert with the right error if caller is not part of the game", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
                const tmpCorrCode = "0x01020304000000000000000000000000";
                const tmpSalt = "0x01020300";

                await expect(griefer.execFunction("revealCode",[gameId, tmpCorrCode, tmpSalt])).to.be.revertedWith("Sender not part of game");
            });

            it("Should revert with the right error if revealed code is called by the breaker and not the maker", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameRevealing);

                // TODO come faccio a dire se gli zeri di troppo sono a destra o a sinistra? convenzione?
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
            //TODO
        });

        describe("-> function dispute", function () {
            it("Should let dispute the breaker e set a turn winner", async function () {
                const { creator, opponent, griefer, manager, gameId, creator_first_breaker, curr_turn, code } = await loadFixture(inGameDisputeTime);

                const tmpGuess = "0x01020304000000000000000000000000";

                if (creator_first_breaker)
                    await creator.execFunction("dispute",[gameId, tmpGuess]);
                else
                    await opponent.execFunction("dispute",[gameId, tmpGuess]);

                await manager.test("disputeSent", (_game_id, _sender) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_sender).to.not.be.undefined;
                });
                await manager.test("disputeWon", (_game_id, _winner) => {
                    expect(_game_id).to.equal(gameId);
                    expect(_winner).to.be.oneOf([opponent.address, creator.address]);
                });
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
            //TODO
        });

    });

        describe("Withdrawals", function () {
            describe("Validations", function () {
        //       it("Should handle stakedfunds and return true", async function () {
        //         const { creator, opponent, griefer, manager, gameId } = await loadFixture(notEmptyStackFixture);
        
        //         await expect(opponent.execFunction("withdraw",[])).to.be.revertedWith("TODO");
        //       });
        
            //   it("Should revert with the right error if called from another account", async function () {
            //     const { lock, unlockTime, otherAccount } = await loadFixture(deployOneYearLockFixture);
        
            //     // We can increase the time in Hardhat Network
            //     await time.increaseTo(unlockTime);
        
            //     // We use lock.connect() to send a transaction from another account
            //     await expect(lock.connect(otherAccount).withdraw()).to.be.revertedWith("You aren't the owner");
            //   });
        
            //   it("Shouldn't fail if the unlockTime has arrived and the owner calls it", async function () {
            //     const { lock, unlockTime } = await loadFixture(deployOneYearLockFixture);
        
            //     // Transactions are sent using the first signer by default
            //     await time.increaseTo(unlockTime);
        
            //     await expect(lock.withdraw()).not.to.be.reverted;
            //   });
            });
        
        //     describe("Events", function () {
        //       it("Should emit an event on withdrawals", async function () {
        //         const { lock, unlockTime, lockedAmount } = await loadFixture(
        //           deployOneYearLockFixture
        //         );
        
        //         await time.increaseTo(unlockTime);
        
        //         await expect(lock.withdraw())
        //           .to.emit(lock, "Withdrawal")
        //           .withArgs(lockedAmount, anyValue); // We accept any value as `when` arg
        //       });
        //     });
        
        //     describe("Transfers", function () {
        //       it("Should transfer the funds to the owner", async function () {
        //         const { lock, unlockTime, lockedAmount, owner } = await loadFixture(
        //           deployOneYearLockFixture
        //         );
        
        //         await time.increaseTo(unlockTime);
        
        //         await expect(lock.withdraw()).to.changeEtherBalances(
        //           [owner, lock],
        //           [lockedAmount, -lockedAmount]
        //         );
        //       });
        //     });
        //   });
        });
});
