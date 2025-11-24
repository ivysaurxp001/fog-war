import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import type { HardhatUserConfig } from "hardhat/config";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

// Load secrets from .env
// Ensure we strip 0x if present in env, then add it back where needed to be safe
const RAW_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PRIVATE_KEY = RAW_PRIVATE_KEY.replace(/^0x/, "");

console.log("DEBUG: RAW_PRIVATE_KEY length:", RAW_PRIVATE_KEY.length);
console.log("DEBUG: Final PRIVATE_KEY length:", PRIVATE_KEY.length);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      // Ensure we add 0x prefix as required by Hardhat
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
};

export default config;
