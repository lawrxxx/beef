// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// BASE SEPOLIA TEST DEPLOYMENTS ONLY — NOT AUDITED.
// beef keeps real-money staking disabled. this contract holds test usdc for duels and
// releases it only with a settlement signed by beef's settlement oracle key.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract BeefEscrow {
    using SafeERC20 for IERC20;

    enum Status { None, Funding, Active, Settled, Refunded }

    struct Duel {
        uint256 stake;           // usdc base units (6 decimals) per participant
        address[] participants;
        uint256 deposits;
        bytes32 termsHash;       // hash of tickers, deadline, methodology, calculation version
        uint64 fundingDeadline;
        Status status;
    }

    uint256 public constant MAX_STAKE = 25e6;      // 25 test usdc
    uint256 public constant MAX_PARTICIPANTS = 6;
    uint64 public constant FUNDING_WINDOW = 2 days;

    IERC20 public immutable usdc;
    address public immutable oracle; // beef settlement service signer

    mapping(bytes32 => Duel) private duels;
    mapping(bytes32 => mapping(address => bool)) public deposited;

    event Created(bytes32 indexed duelId, address indexed creator, uint256 stake, bytes32 termsHash);
    event Deposited(bytes32 indexed duelId, address indexed who);
    event Activated(bytes32 indexed duelId);
    event Settled(bytes32 indexed duelId, address[] winners, bytes32 settlementHash);
    event Refunded(bytes32 indexed duelId);

    error NotParticipant();
    error BadState();
    error BadParams();
    error BadSignature();

    constructor(IERC20 _usdc, address _oracle) {
        if (address(_usdc) == address(0) || _oracle == address(0)) revert BadParams();
        usdc = _usdc;
        oracle = _oracle;
    }

    /// creator registers the duel and pays their stake in the same call.
    function createDuel(bytes32 duelId, uint256 stake, address[] calldata participants, bytes32 termsHash) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.None) revert BadState();
        if (stake == 0 || stake > MAX_STAKE) revert BadParams();
        uint256 n = participants.length;
        if (n < 2 || n > MAX_PARTICIPANTS) revert BadParams();
        bool creatorIn;
        for (uint256 i; i < n; i++) {
            address p = participants[i];
            if (p == address(0)) revert BadParams();
            for (uint256 j = i + 1; j < n; j++) if (participants[j] == p) revert BadParams();
            if (p == msg.sender) creatorIn = true;
        }
        if (!creatorIn) revert NotParticipant();
        d.stake = stake;
        d.participants = participants;
        d.termsHash = termsHash;
        d.fundingDeadline = uint64(block.timestamp) + FUNDING_WINDOW;
        d.status = Status.Funding;
        emit Created(duelId, msg.sender, stake, termsHash);
        _deposit(duelId, d);
    }

    /// other participants accept by depositing their stake.
    function deposit(bytes32 duelId) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.Funding || block.timestamp > d.fundingDeadline) revert BadState();
        _deposit(duelId, d);
    }

    function _deposit(bytes32 duelId, Duel storage d) private {
        if (!_isParticipant(d, msg.sender)) revert NotParticipant();
        if (deposited[duelId][msg.sender]) revert BadState();
        deposited[duelId][msg.sender] = true;
        d.deposits++;
        usdc.safeTransferFrom(msg.sender, address(this), d.stake);
        emit Deposited(duelId, msg.sender);
        if (d.deposits == d.participants.length) { d.status = Status.Active; emit Activated(duelId); }
    }

    /// pays out a settlement signed by the oracle. can only happen once per duel.
    /// winners = [] means a draw: every stake is returned.
    function settle(bytes32 duelId, address[] calldata winners, bytes32 settlementHash, bytes calldata oracleSig) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.Active) revert BadState();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(settlementDigest(duelId, d.termsHash, winners, settlementHash));
        if (ECDSA.recover(digest, oracleSig) != oracle) revert BadSignature();
        for (uint256 i; i < winners.length; i++) if (!_isParticipant(d, winners[i])) revert NotParticipant();
        d.status = Status.Settled; // effects before transfers
        uint256 n = d.participants.length;
        if (winners.length == 0) {
            for (uint256 i; i < n; i++) usdc.safeTransfer(d.participants[i], d.stake);
        } else {
            uint256 pot = d.stake * n;
            uint256 share = pot / winners.length;
            for (uint256 i; i < winners.length; i++) usdc.safeTransfer(winners[i], share);
            uint256 dust = pot - share * winners.length;
            if (dust > 0) usdc.safeTransfer(winners[0], dust);
        }
        emit Settled(duelId, winners, settlementHash);
    }

    /// if funding never completed, anyone can return the deposits after the window.
    function refund(bytes32 duelId) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.Funding || block.timestamp <= d.fundingDeadline) revert BadState();
        d.status = Status.Refunded;
        for (uint256 i; i < d.participants.length; i++) {
            address p = d.participants[i];
            if (deposited[duelId][p]) usdc.safeTransfer(p, d.stake);
        }
        emit Refunded(duelId);
    }

    /// the message the oracle signs. bound to this chain and this contract (no replay).
    function settlementDigest(bytes32 duelId, bytes32 termsHash, address[] calldata winners, bytes32 settlementHash) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), duelId, termsHash, winners, settlementHash));
    }

    function getDuel(bytes32 duelId) external view returns (
        uint256 stake, address[] memory participants, uint256 deposits, bytes32 termsHash, uint64 fundingDeadline, Status status
    ) {
        Duel storage d = duels[duelId];
        return (d.stake, d.participants, d.deposits, d.termsHash, d.fundingDeadline, d.status);
    }

    function _isParticipant(Duel storage d, address a) private view returns (bool) {
        for (uint256 i; i < d.participants.length; i++) if (d.participants[i] == a) return true;
        return false;
    }
}
