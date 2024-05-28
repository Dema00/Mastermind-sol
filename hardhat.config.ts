import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ignition-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import 'solidity-coverage';
import 'hardhat-gas-reporter';

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      // See its defaults
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  // https://medium.com/@abhijeet.sinha383/how-to-calculate-gas-and-costs-while-deploying-solidity-contracts-and-functions-54007d321626
  gasReporter: {
    enabled: true,
    noColors: true,
    currency: "EUR",
    outputFile: "hardhat-gas-report.txt",
    // gasPrice: 21,  // Specify gas price in gwei if needed (optional)
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },

    },

  },
};

export default config;
