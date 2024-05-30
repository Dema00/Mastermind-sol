import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CounterModule = buildModule("CounterModule", (m) => {
  // Deploy the Mastermind contract and link the libraries
  const count = m.contract("Counter", [],{});

  return { count };
});

export default CounterModule;
