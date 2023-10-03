const { ethers } = require("hardhat");
const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;
const { TestSystem, lyraUtils, lyraConstants } = require('@lyrafinance/protocol');
const fs = require('fs');
const path = require('path');


let signer, provider, localTestSystem, boardIds, strikeIds, strike, optionTokenContract;

describe('Lyra local environment Test', () => {
    before(async () => {
        // 1. Load signer and provider
        [signer] = await ethers.getSigners();
        provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');

        // 2. Optional settings to prevent errors according to documentation
        provider.getGasPrice = async () => { return ethers.BigNumber.from('0'); };
        provider.estimateGas = async () => { return ethers.BigNumber.from(15000000); }

        // 3. Deploy and seed Lyra market
        let linkTracer = false;
        let exportAddresses = true;
        localTestSystem = await TestSystem.deploy(signer, linkTracer, exportAddresses);
        await TestSystem.seed(signer, localTestSystem, overrides={});

        // Load OptionToken contract from localTestSystem
        const optionTokenContractAddress = localTestSystem.optionToken.address;
        let contractABIPath = path.resolve(process.cwd(), "artifacts/@lyrafinance/protocol/contracts/OptionToken.sol/OptionToken.json");
        let contractArtifact = JSON.parse(fs.readFileSync(contractABIPath, 'utf8'));
        optionTokenContract  = new ethers.Contract(optionTokenContractAddress, contractArtifact.abi, signer);
        
        console.log('------------------------------------------------------------------------');
        console.log('- Lyra local environment Test');
        console.log('------------------------------------------------------------------------');
        console.log();
    });

    it('localTestSystem initialization test', async () => {
        // Get information from optionMarket
        boardIds = await localTestSystem.optionMarket.getLiveBoards();
        strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);
        strike = await localTestSystem.optionMarket.getStrike(strikeIds[0]);
        const optionTokenAmount = await optionTokenContract.balanceOf(signer.address);

        expect(strike.longCall).to.be.equals(0);
        expect(optionTokenAmount).to.be.equals(0);
        
    });

    it('Open position test', async () => {
        // Get information from optionMarket
        boardIds = await localTestSystem.optionMarket.getLiveBoards();
        strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);

        // Allowance implemented at local test system initialization (I guess)

        // 4. call local contracts
        const tx = await localTestSystem.optionMarket.openPosition({
            strikeId: strikeIds[0],
            positionId: 0,
            optionType: TestSystem.OptionType.LONG_CALL,
            amount: lyraUtils.toBN("1"),
            setCollateralTo: lyraUtils.toBN("0"),
            iterations: 1,
            minTotalCost: lyraUtils.toBN("0"),
            maxTotalCost: lyraConstants.MAX_UINT,
        });
        tx.wait();

        // Check result
        boardIds = await localTestSystem.optionMarket.getLiveBoards();
        strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);
        strike = await localTestSystem.optionMarket.getStrike(strikeIds[0]);
        const optionTokenAmount = await optionTokenContract.balanceOf(signer.address);
        const position = await optionTokenContract.positions(1);

        expect(strike.longCall).to.be.equals(lyraUtils.toBN("1"));
        expect(optionTokenAmount).to.be.equals(1);
        expect(position.strikeId).to.be.equals(strikeIds[0]);
        expect(position.optionType).to.be.equals(TestSystem.OptionType.LONG_CALL);
        expect(position.amount).to.be.equals(lyraUtils.toBN("1"));
        expect(position.collateral).to.be.equals(0);
        expect(position.state).to.be.equals(TestSystem.PositionState.ACTIVE);
    });
});