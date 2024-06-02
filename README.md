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
# Verify the installation
node -v # we use 'v20.13.1'
npm -v # we use '10.5.2'
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
# You need to install these dependencies to run the sample project:
npm install --save-dev "hardhat@^2.22.4" "@nomicfoundation/hardhat-toolbox@^5.0.0"
```
You can check for all outdated packages:
```sh
npm outdated
```
And update them:
```sh
npm update
```
After updating, you might want to audit the packages again:
```sh
npm audit
```
This will ensure your dependencies are up to date and secure.  
Set the project to support Typescript with
```sh
npm install --save-dev ts-node typescript
npm install --save-dev chai@4 @types/node @types/mocha @types/chai@4
```
We will also need
```
npm install --save-dev @nomiclabs/hardhat-ethers ethers

# Add the following line to hardhat.config.ts file
import '@nomiclabs/hardhat-ethers';
```
use `--force` for the installatoin if there are problems.  
To remove `node_modules` and reinstall dependencies, use:  
If you encounter errors or strange behavior that might be related to corrupted dependencies, a clean reinstall can help:
```sh
rm -rf node_modules
npm install
```
When upgrading major versions of libraries, removing and reinstalling dependencies ensures no outdated dependencies.
# Hardhat Project
Every time we run Hardhat from CLI we are running a Task (like `npx hardhat compile`, `npx hardhat deploy`, `npx hardhat test`). Tasks can call other tasks and generate complex workflows.  
We are going to use a Hardhat on local network, so that we avoid pay for the usage of public blockchain network or testnet. Another advantage is the reproducibility of the code due to same execution condition like same private kays and users addresses (reproducibility ⮕ testable).  
Hardhat Network is based on *@ethereumjs/vm* EVM implementation that by default mines a block with each transaction that receives, in order with no delay.
## Sample Project
This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.  

Try running some of the following tasks:  

```bash
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```
### ⮕ npx hardhat compile
**Steps Involved**:
- **Reads Configuration:** Hardhat reads the `hardhat.config.ts` file to determine which compiler version to use and other settings.
- **Compiles Solidity Files:** Hardhat uses the specified Solidity compiler to compile each `.sol` file in the `contracts` directory.
- **Generates Artifacts:** Creates JSON files in the `artifacts` directory containing the compiled bytecode and ABI(Application Binary Interface) definitions.  
- Example Output:  
   - Bytecode: The machine code that will be deployed to the Ethereum network.
   - ABI (Application Binary Interface): A JSON file that defines how to interact with the smart contract functions.
### ⮕ npx hardhat test
**Steps Involved**:
- **Runs Testing Framework:** Hardhat uses Mocha (a JavaScript test framework) and Chai (an assertion library) to execute the tests.
- **Deploys Contracts to Local Network:** Before running tests, Hardhat spins up a local Ethereum network and deploys the contracts to it.
- **Executes Tests:** Runs the test scripts located in the `test` directory.
- Example Output:
  - Test Results: Pass or fail status for each test, along with detailed error messages for any failed tests.
  - Gas Report: (If using a gas plugin) Information about how much gas is consumed.
### ⮕ npx hardhat deploy
**Steps Involved**:
- **Reads Configuration:** Hardhat reads the `hardhat.config.ts` to determine deployment settings and the target network.
- **Runs Deployment Scripts:** Executes scripts located in the `deploy` directory that define how and where the contracts should be deployed.
- **Network Interaction:** Sends transactions to the specified network to deploy the compiled contracts.
- Example Output:
  - Deployed Contract Address: The address where the contract is deployed on the Ethereum network.
  - Deployment Logs: Information about the deployment process, such as transaction hashes and gas used.
## Plugin
First we need to install the plugins. Run the following command in your project directory to get them:
```sh
npm install --save-dev solidity-coverage
npm install --save-dev hardhat-gas-reporter
```
Next, you need to require the plugin in your Hardhat configuration file. Open *hardhat.config.ts* and add the following line after the others import:
```
import 'solidity-coverage';
import 'hardhat-gas-reporter';
```
In *hardhat.config.ts*  we can also setup some configuration for gasReporter, defaultNetwork, paths, solidity compiler.  
Now you can run the coverage analysis by executing the following command `npx hardhat coverage` or ,with the gas reporter configured, you can now run your tests as `npx hardhat test`, and it will automatically generate a gas usage report.  
Using `import "hardhat/console.sol";` in the smart contract let us console.log from our solidity code (can check launching the test).  
Both commands can be run without spin up any chain server, this because Hardhat has his built-in block chain feature.
## Compile, Deploy, Use
Compile using `npx hardhat compile` the files in **/contracts**, this generate two files per compiled contract: an artifact(.json) and a debug file(.dbg.json). Can be used `npx hardhat clean` to clear the cache and to delete the artifact.  
Deployments are defined through Ignition Modules, these are abstraction to describe a deployment.   
Before launch the ignition script `npx hardhat ignition deploy ./ignition/modules/<Contract-name>.ts --network <net-name>` make sure your local node is running. If you're using localhost Hardhat Network, you can start it by running `npx hardhat node`.
_____________________________________________________________  
**Point Out**  
We could also launch a deployment script `npx hardhat run scripts/deploy.js --network <net-name>` make sure your local node is running. If you're using localhost Hardhat Network, you can start it by running `npx hardhat node`.  
**{** The command you should use depends on what you want to do. If you want to deploy your contracts, use `npx hardhat deploy`. If you want to run a specific script, use `npx hardhat run <script>` or `npx hardhat ignition deploy <ignition>`. `npx hardhat ignition` facilitates the deployment of complex Ethereum applications, especially useful for larger projects where managing the deployment of multiple contracts and their interdependencies can become challenging. **}**  
_____________________________________________________________  
Can manually interact with the contract using `npx hardat console --network <net-name>`.  
From the console we can directly write commands or load script.js files using `.load <path-file>` (base folder should be the one from console has been launched). Command `.save` let us save/dump all evaluated commands in REPL/console session to a local file.  
