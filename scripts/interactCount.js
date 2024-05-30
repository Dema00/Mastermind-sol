// .load scripts/interactCount.js

const { ethers } = require("hardhat");

// Step: Getting a contract instance
const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Replace with your contract's address
const Counter = await ethers.getContractFactory("Counter");
const counter = await Counter.attach(contractAddress);

const currentCounterVal = await counter.get();
console.log(currentCounterVal);

await counter.inc();
await counter.inc();
currentCounterVal = await counter.get();
console.log(currentCounterVal);

await counter.inc();
await counter.dec();
await counter.dec();
currentCounterVal = await counter.get();
console.log(currentCounterVal);

let tx = await counter.inc();
console.log(tx.hash);

currentCounterVal = await counter.inc();
console.log('sembra non andare ', currentCounterVal.toString());

console.log('cosi sembra andare(NO) ', (await counter.inc()).toString());

(await counter.inc()).toString();
console.log('cosi si invece(NO)');

console.log('male perche usavo inc, se uso get tutto funziona');
currentCounterVal = await counter.get();
console.log('infatti ', currentCounterVal.toString());
(await counter.get()).toString();
