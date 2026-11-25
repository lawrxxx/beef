// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// REFERENCE DESIGN ONLY — NOT AUDITED, NOT DEPLOYED.
// beef keeps real-money staking disabled until legal review, custody arrangements,
// an oracle that can attest official closing prices, and a security audit are complete.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract BeefEscrow {
    using SafeERC20 for IERC20;

    enum Status { None, Funding, Active, Settled, Refunded }

    struct Duel {
        uint256 stake;           // usdc (6 decimals) per participant
        address[] participants;
        mapping(address => bool) deposited;
        uint256 deposits;
        bytes32 termsHash;       // hash of tickers, deadline, methodology, calculation version
        uint64 fundingDeadline;
        Status status;
    }

    IERC20 public immutable usdc;
    address public immutable oracle; // signer that attests settlement results

    mapping(bytes32 => Duel) private duels;

    event Created(bytes32 indexed duelId, bytes32 termsHash);
    event Deposited(bytes32 indexed duelId, address indexed who);
    event Activated(bytes32 indexed duelId);
    event Settled(bytes32 indexed duelId, bytes32 settlementHash);
    event Refunded(bytes32 indexed duelId);

    constructor(IERC20 _usdc, address _oracle) { usdc = _usdc; oracle = _oracle; }

    function createDuel(bytes32 duelId, uint256 stake, address[] calldata participants, bytes32 termsHash) external {
        Duel storage d = duels[duelId];
        require(d.status == Status.None, "exists");
        require(participants.length >= 2 && participants.length <= 8, "participants");
        d.stake = stake;
        d.participants = participants;
        d.termsHash = termsHash;
        d.fundingDeadline = uint64(block.timestamp + 2 days);
        d.status = Status.Funding;
        emit Created(duelId, termsHash);
    }

    function deposit(bytes32 duelId) external {
        Duel storage d = duels[duelId];
        require(d.status == Status.Funding, "not funding");
        require(_isParticipant(d, msg.sender) && !d.deposited[msg.sender], "cannot deposit");
        d.deposited[msg.sender] = true;
        d.deposits++;
        usdc.safeTransferFrom(msg.sender, address(this), d.stake);
        emit Deposited(duelId, msg.sender);
        if (d.deposits == d.participants.length) { d.status = Status.Active; emit Activated(duelId); }
    }

    /// settlement is idempotent: a duel can only leave Active once.
    function settle(bytes32 duelId, address[] calldata winners, bytes32 settlementHash, bytes calldata oracleSig) external {
        Duel storage d = duels[duelId];
        require(d.status == Status.Active, "not active");
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(duelId, d.termsHash, winners, settlementHash)));
        require(ECDSA.recover(digest, oracleSig) == oracle, "bad oracle sig");
        d.status = Status.Settled;
        uint256 pot = d.stake * d.participants.length;
        if (winners.length == 0) {
            // draw: everyone gets their stake back
            for (uint256 i; i < d.participants.length; i++) usdc.safeTransfer(d.participants[i], d.stake);
        } else {
            uint256 share = pot / winners.length;
            for (uint256 i; i < winners.length; i++) { require(_isParticipant(d, winners[i]), "winner"); usdc.safeTransfer(winners[i], share); }
        }
        emit Settled(duelId, settlementHash);
    }

    /// anyone can trigger a refund if funding never completed.
    function refund(bytes32 duelId) external {
        Duel storage d = duels[duelId];
        require(d.status == Status.Funding && block.timestamp > d.fundingDeadline, "no refund");
        d.status = Status.Refunded;
        for (uint256 i; i < d.participants.length; i++) {
            if (d.deposited[d.participants[i]]) usdc.safeTransfer(d.participants[i], d.stake);
        }
        emit Refunded(duelId);
    }

    function _isParticipant(Duel storage d, address a) private view returns (bool) {
        for (uint256 i; i < d.participants.length; i++) if (d.participants[i] == a) return true;
        return false;
    }
}
