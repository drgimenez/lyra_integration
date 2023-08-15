//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@lyrafinance/protocol/contracts/interfaces/IOptionMarket.sol";
import "@lyrafinance/protocol/contracts/interfaces/IOptionToken.sol";

/// @author David Gimenez: drgimenez@gmail.com
/// @notice This contract implements integration with the Lyda protocol using an OptionMarket contract
contract Strands is ReentrancyGuard, IERC721Receiver {

    /// @notice Store the address of the stablecoin contract used as the quote asset
    address public stableCoinContract;
    /// @notice Store the address of the OptionToken contract, ERC721 compatible
    address public optionTokenContract;
    /// @notice Store the address of the options market contract given by the Lyra protocol to operate
    address public optionMarketContract;

    /// @notice Identify each position with its owner
    mapping(uint256 => address) public positionOf;

    /// @notice Initializes the contract components
    /// @dev Revert if '_stableCoinContract' is zero address, message "Invalid _stableCoinContract address"
    /// @dev Revert if '_optionTokenContract' is zero address, message "Invalid _optionTokenContract address"
    /// @dev Revert if '_optionMarketContract' is zero address, message "Invalid _optionMarketContract address"
    /// @param _stableCoinContract This is the contract address of the stablecoin used as the quote asset.
    /// @param _optionTokenContract This is the contract address of the optionToken Contract, ERC721 compatible.
    /// @param _optionMarketContract It is the address of the options market contract given by the Lyra protocol to operate
    constructor(address _stableCoinContract, address _optionTokenContract, address _optionMarketContract) {
        require(_stableCoinContract != address(0), "Invalid _stableCoinContract address");
        require(_optionTokenContract != address(0), "Invalid _optionTokenContract address");
        require(_optionMarketContract != address(0), "Invalid _optionMarketContract address");

        stableCoinContract = _stableCoinContract;
        optionTokenContract = _optionTokenContract;
        optionMarketContract = _optionMarketContract;
    }

    /// @notice Open a position in the options market contract on behalf of the sender, 
    /// allowing it to buy both a call and a put option on a strikeId in one atomic transaction
    /// @dev The function should take stablecoins from the msg.sender account
    /// @dev Revert if '_size' is zero, message "Error: Invalid _size"
    /// @dev Revert if '_strikeId' is not a valid strikeId in the optionMarket contract, 
    /// message "Error: Invalid _strikeId"
    /// @param _size It is the size of the option contract to buy.
    /// @param _strikeId It is the strikeId ofered in the optionMarket contract.
    /// @return success True if the transaction is successful, false otherwise.
    function buyStraddle(uint256 _size, uint256 _strikeId) external nonReentrant() returns(bool success) {
        require(_size > 0, "Error: Invalid _size");
        uint256 strikePrice = IOptionMarket(optionMarketContract).getStrike(_strikeId).strikePrice;
        require(strikePrice > 0, "Error: Invalid _strikeId");

        // Current contract balance
        uint256 initialBalance = IERC20(stableCoinContract).balanceOf(address(this));
        
        // Take ownership of stablecoins
        (success) = IERC20(stableCoinContract).transferFrom(msg.sender, address(this), strikePrice);
        require(success, "Error: stableCoinContract transfer failed");

        // Approves the optionMarketContract to spend from this contract account in the stableCoinContract
        (success) = IERC20(stableCoinContract).approve(optionMarketContract, strikePrice);
        require(success, "Error: stableCoinContract approve failed");

        // Call and put operation parametters
        IOptionMarket.OptionType _longCall = IOptionMarket.OptionType.LONG_CALL;
        IOptionMarket.TradeInputParameters memory inputParams = IOptionMarket.TradeInputParameters({
            strikeId: _strikeId,            // id of strike
            positionId: 0,                  // OptionToken ERC721 id for position (set to 0 for new positions)
            iterations: 1,                  // number of sub-orders to break order into (reduces slippage)
            optionType: _longCall,          // type of option to trade
            amount: _size,                  // number of contracts to trade
            setCollateralTo: 0,             // final amount of collateral to leave in OptionToken position
            minTotalCost: 0,                // revert trade if totalCost is below this value
            maxTotalCost: type(uint).max    // revert trade if totalCost is above this value
        });
        
        // Open long call position
        _openPosition(inputParams);
                
        // Open long put position
        inputParams.optionType = IOptionMarket.OptionType.LONG_PUT;
        _openPosition(inputParams);
        
        // If there is excess money, the user will be reimbursed.
        uint256 finalBalance = IERC20(stableCoinContract).balanceOf(address(this));
        uint256 amountToRefund = finalBalance - initialBalance;
        if (amountToRefund > 0) {
            _refund(amountToRefund);
        }
    }

    /// @notice Allow the owner of a position to transfer the position to a valid IERC721Receiver address
    /// @dev The function deletes the position from this contract.
    /// @dev Revert if 'msg.sender' is not the owner of the position, message: "Error: Not the position owner"
    /// @dev Revert if '_recipient' is zero address, message "Error: Invalid _recipient"
    /// @dev Revert if '_recipient' is not a valid IERC721Receiver address, message 
    /// "Not a valid IERC721Receiver address"
    /// @param _positionId It is the identifier of the position to be transferred.
    /// @param _recipient It is the destination address of the position transfer.
    /// @return success True if the transaction is successful, false otherwise.
    function safeTransferPosition(uint256 _positionId, address _recipient) external nonReentrant() returns(bool success) {
        require(positionOf[_positionId] == msg.sender, "Error: Not the position owner");
        require(_recipient != address(0), "Error: Invalid _recipient");
        require(_isValidERC721Received(_recipient, _recipient, address(this), _positionId), "Not a valid IERC721Receiver address");

        delete positionOf[_positionId];
        try IOptionToken(optionTokenContract).safeTransferFrom(address(this), _recipient, _positionId) {
            return true;
        }
        catch Error(string memory _errorMessage) {
            revert(_errorMessage); // or custom message 
        }
    }

    /**
     * @dev Whenever an {IERC721} `tokenId` token is transferred to this contract via {IERC721-safeTransferFrom}
     * by `operator` from `from`, this function is called.
     *
     * It must return its Solidity selector to confirm the token transfer.
     * If any other value is returned or the interface is not implemented by the recipient, the transfer will be reverted.
     *
     * The selector can be obtained in Solidity with `IERC721Receiver.onERC721Received.selector`.
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// ------------------------------------------------------------------------------------------------------------------------------------
    /// PRIVATE FUNCTIONS
    /// ------------------------------------------------------------------------------------------------------------------------------------

    function _openPosition(IOptionMarket.TradeInputParameters memory _inputParams) private returns (IOptionMarket.Result memory) {
        try IOptionMarket(optionMarketContract).openPosition(_inputParams) returns (IOptionMarket.Result memory _result) {
            if (_result.positionId == 0) {
                revert ("Error: Call buy failed");
            }

            positionOf[_result.positionId] = msg.sender;
            return _result;
        }
        catch Error(string memory _errorMessage) {
            revert(_errorMessage); // or custom message 
        }
    }

    function _refund(uint256 _amountToRefund) private {
        require(_amountToRefund > 0, "Error: Invalid amount to refund");
        (bool success) = IERC20(stableCoinContract).transfer(msg.sender, _amountToRefund);
        require(success, "Error: stableCoinContract transfer failed");
    }

    function _isValidERC721Received(address _to, address _operator, address _from, uint256 _tokenId) internal returns (bool) {
        if (_isSmartContract(_to)) {
            bytes4 ERC721_TokenReceiver_Hash = 0x150b7a02;
            bytes memory _data;

            try IERC721Receiver(_to).onERC721Received(_operator, _from, _tokenId, _data) returns (bytes4 ERC721Received_result) {
                if (ERC721Received_result != ERC721_TokenReceiver_Hash) {
                    return false;
                }
            }
            catch {
                return false;
            }
        }
        return true;
    }

    function _isSmartContract(address _address) internal view returns (bool) {
        bytes32 zeroAccountHash = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;
        bytes32 codeHash;
        assembly {
            codeHash := extcodehash(_address)
        }
        return (codeHash != zeroAccountHash && codeHash != 0x0);
    }
}