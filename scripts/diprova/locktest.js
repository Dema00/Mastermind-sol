// .load scripts/locktest.js

// Step 1: Get the deployer account
const [deployer] = await ethers.getSigners();
console.log("Deployer address:", deployer.address);

// Step 2: Attach to the deployed contract
const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Replace with your contract's address
const Lock = await ethers.getContractFactory("Lock");
const lock = await Lock.attach(contractAddress);

// Step 3: Check the unlock time
const unlockTime = await lock.unlockTime();
console.log("Unlock time:", unlockTime.toString());

// Step 4: Check the contract balance (amount of funds that can be retrieved)
// const contractBalance = await ethers.provider.getBalance(lock.address);
// console.log("Contract balance (funds to be retrieved):", ethers.utils.formatEther(contractBalance), "ETH");
// const contractBalance2 = await ethers.provider.getBalance(contractAddress);
// const formattedBalance = ethers.utils.formatEther(contractBalance);
// console.log("Contract balance (funds to be retrieved):", formattedBalance, "ETH");

// Step 5: Attempt to withdraw if unlock time has passed
const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
if (currentTime >= unlockTime) {
    console.log("Entrato in Withdrawal");
    const tx = await lock.withdraw();
    await tx.wait();
    console.log("Withdrawal successful");

    // Step 6: Check the contract balance after withdrawal
    const newContractBalance = await ethers.provider.getBalance(lock.address);
    console.log("New contract balance:", ethers.utils.formatEther(newContractBalance), "ETH");
} else {
    console.log("Unlock time hasn't passed yet. Please wait.");
}
