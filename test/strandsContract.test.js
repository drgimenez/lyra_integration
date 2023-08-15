const { ethers } = require("hardhat");
const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;
const { TestSystem, lyraUtils, lyraConstants } = require('@lyrafinance/protocol');
const fs = require('fs');
const path = require('path');
const { ZERO_ADDRESS } = require("@lyrafinance/protocol/dist/scripts/util/web3utils");

let signer, provider, localTestSystem, boardIds, strikeIds, strike, tx;
let contractPath, contractFactory, stableCoinContract, optionTokenContract, strandsContract;

describe('Integration Test', () => {
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

        // Load StableCoin contract from localTestSystem
        const StableCoinContractAddress = localTestSystem.snx.quoteAsset.address;
        let contractABIPath = path.resolve(process.cwd(), "artifacts/@lyrafinance/protocol/contracts/test-helpers/TestERC20.sol/TestERC20.json");
        let contractArtifact = JSON.parse(fs.readFileSync(contractABIPath, 'utf8'));
        stableCoinContract  = new ethers.Contract(StableCoinContractAddress, contractArtifact.abi, signer);

        // Load OptionToken contract from localTestSystem
        const optionTokenContractAddress = localTestSystem.optionToken.address;
        contractABIPath = path.resolve(process.cwd(), "artifacts/@lyrafinance/protocol/contracts/OptionToken.sol/OptionToken.json");
        contractArtifact = JSON.parse(fs.readFileSync(contractABIPath, 'utf8'));
        optionTokenContract  = new ethers.Contract(optionTokenContractAddress, contractArtifact.abi, signer);
        
        // Deploy Strands contract
        contractPath = "contracts/Strands.sol:Strands";
        contractFactory = await ethers.getContractFactory(contractPath, signer);
        strandsContract = await contractFactory.deploy(
            stableCoinContract.address, 
            optionTokenContract.address,
            localTestSystem.optionMarket.address
            );

            console.log('------------------------------------------------------------------------');
            console.log('- Integration Test');
            console.log('------------------------------------------------------------------------');
            console.log();
    });

    describe("Initialization test", () => {
        it('localTestSystem initialization test', async () => {
            // Get information from optionMarket
            boardIds = await localTestSystem.optionMarket.getLiveBoards();
            strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);
            strike = await localTestSystem.optionMarket.getStrike(strikeIds[0]);
            const optionTokenAmount = await optionTokenContract.balanceOf(strandsContract.address);

            expect(strike.longCall).to.be.equals(0);
            expect(optionTokenAmount).to.be.equals(0);            
        });

        it('Strands contract initialization test', async () => {
            // Check if deployed correctly
            const stableCoinContract_received = await strandsContract.stableCoinContract();
            const optionMarketContract_received = await strandsContract.optionMarketContract();

            expect(stableCoinContract_received).to.be.equals(stableCoinContract.address);
            expect(optionMarketContract_received).to.be.equals(localTestSystem.optionMarket.address);
        });
    });

    describe("Strands contract test", () => {
        it('Use Lyra local test system to test buyStraddle function test', async () => {
            // Get information from optionMarket
            boardIds = await localTestSystem.optionMarket.getLiveBoards();
            strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);

            // Approve Strands contract to transfer amount from signer address
            const strikePrice = (await localTestSystem.optionMarket.getStrike(strikeIds[0])).strikePrice;
            tx = await stableCoinContract.approve(strandsContract.address, strikePrice);
            await tx.wait(1);

            // Call Strands contract
            const amount = ethers.utils.parseEther("1");
            tx = await strandsContract.buyStraddle(amount, strikeIds[0]);
            await tx.wait(1)

            // Check result
            boardIds = await localTestSystem.optionMarket.getLiveBoards();
            strikeIds = await localTestSystem.optionMarket.getBoardStrikes(boardIds[0]);
            strike = await localTestSystem.optionMarket.getStrike(strikeIds[0]);
            const optionTokenAmount = await optionTokenContract.balanceOf(strandsContract.address);
            const position1 = await optionTokenContract.positions(1);
            const position2 = await optionTokenContract.positions(2);
            const position1Owner = await strandsContract.positionOf(1);
            const position2Owner = await strandsContract.positionOf(2);

            expect(strike.longCall).to.be.equals(lyraUtils.toBN("1"));
            expect(strike.longPut).to.be.equals(lyraUtils.toBN("1"));
            expect(optionTokenAmount).to.be.equals(2);

            // Position 1
            expect(position1.strikeId).to.be.equals(strikeIds[0]);
            expect(position1.optionType).to.be.equals(TestSystem.OptionType.LONG_CALL);
            expect(position1.amount).to.be.equals(lyraUtils.toBN("1"));
            expect(position1.collateral).to.be.equals(0);
            expect(position1.state).to.be.equals(TestSystem.PositionState.ACTIVE);
            expect(position1Owner).to.be.equals(signer.address);

            // Position 2
            expect(position2.strikeId).to.be.equals(strikeIds[0]);
            expect(position2.optionType).to.be.equals(TestSystem.OptionType.LONG_PUT);
            expect(position2.amount).to.be.equals(lyraUtils.toBN("1"));
            expect(position2.collateral).to.be.equals(0);
            expect(position2.state).to.be.equals(TestSystem.PositionState.ACTIVE);
            expect(position2Owner).to.be.equals(signer.address);
        });

        it('Valid IERC721Receiver contract test', async () => {
            const expected_Hash = "0x150b7a02";
            const recived_Hash = await strandsContract.onERC721Received(signer.address, signer.address, 1, ethers.utils.toUtf8Bytes(""));
            expect(recived_Hash).to.be.equals(expected_Hash);
        });

        it('Try safeTransferPosition to an invalid IERC721Receiver contract address test', async () => {
            // Deploy Test contract
            contractPath = "contracts/TestContract2.sol:TestContract2";
            contractFactory = await ethers.getContractFactory(contractPath, signer);
            const testContract2 = await contractFactory.deploy();

            const positionId = 1;
            await expect(strandsContract.safeTransferPosition(positionId, testContract2.address)).to.be.revertedWith("Not a valid IERC721Receiver address");
        });

        it('safeTransferPosition to owner test', async () => {
            const positionId = 1;
            const position1Owner_Before = await optionTokenContract.ownerOf(positionId);
            const positionOf_before = await strandsContract.positionOf(positionId);

            // Transfer position
            tx = await strandsContract.safeTransferPosition(positionId, signer.address);
            tx.wait(1); 

            const position1Owner_After = await optionTokenContract.ownerOf(positionId);
            const positionOf_After = await strandsContract.positionOf(1);

            expect(position1Owner_Before).to.be.equals(strandsContract.address);
            expect(positionOf_before).to.be.equals(signer.address);

            expect(position1Owner_After).to.be.equals(signer.address);
            expect(positionOf_After).to.be.equals(ZERO_ADDRESS);
        });

        it('safeTransferPosition to a valid IERC721Receiver contract address test', async () => {
            // Deploy Test contract
            contractPath = "contracts/TestContract.sol:TestContract";
            contractFactory = await ethers.getContractFactory(contractPath, signer);
            const testContract = await contractFactory.deploy();

            const positionId = 2;
            const position2Owner_Before = await optionTokenContract.ownerOf(positionId);
            const positionOf_before = await strandsContract.positionOf(positionId);

            // Transfer position
            tx = await strandsContract.safeTransferPosition(positionId, testContract.address);
            tx.wait(1); 

            const position2Owner_After = await optionTokenContract.ownerOf(positionId);
            const positionOf_After = await strandsContract.positionOf(1);

            expect(position2Owner_Before).to.be.equals(strandsContract.address);
            expect(positionOf_before).to.be.equals(signer.address);

            expect(position2Owner_After).to.be.equals(testContract.address);
            expect(positionOf_After).to.be.equals(ZERO_ADDRESS);
        });
    });
});