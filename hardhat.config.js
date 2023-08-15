require('dotenv').config();
require('@nomiclabs/hardhat-ethers');
require('solidity-coverage');
require('hardhat-dependency-compiler');
const { lyraContractPaths } = require('@lyrafinance/protocol/dist/test/utils/package/index-paths');

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: '0.8.9',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    linea: {
        chainId:  59140,
        timeout:  20000,
        gas:      "auto",
        name:     "Linea",		
		url:      process.env.LINEA_ACCESSPOINT_URL,
		from:     process.env.LINEA_ACCOUNT,
        accounts: [process.env.LINEA_PRIVATE_KEY]
	  }
  },
  etherscan: {
    apiKey: process.env.LINEA_APIKEY,
    customChains: [
      {
        network: "linea",
        chainId: 59140,
        urls: {
          apiURL: "https://api-testnet.lineascan.build/api",
          browserURL: "https://goerli.lineascan.build/"
        }
      }
    ]
  },
  dependencyCompiler: {
    paths: lyraContractPaths,
  },
};