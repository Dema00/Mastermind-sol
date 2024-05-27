# Setup the machine
Some requirements we need to install before start:  
- Node.js
- Npm
- Javascript
- Typescript

## Install dependencies
As explained in the Node.js installation guide
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# After installation close and reopen a new terminal to see nvm
nvm install 20
# Verify that
node -v # should print 'v20.13.1'
npm -v # should print '10.5.2'
```
## Initialize the folder
```bash
# Need a folder where to start the project
mkdir testPrj
cd testPrj
npm init -y
npm install --save-dev hardhat
# To use your local installation of Hardhat, you need to use npx to run it (i.e. npx hardhat init).
npx hardhat init # we chose second option Typescript, after the current foldet and all Y.
```
# Sample Hardhat Project
This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.  

Try running some of the following tasks:  

```bash
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```
