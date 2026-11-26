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

    uint256 public constant MAX_PARTICIPANTS = 6;
    uint64 public constant FUNDING_WINDOW = 2 days;

    IERC20 public immutable usdc;
    address public immutable oracle; // beef settlement service signer
    uint256 public immutable minStake; // per participant, usdc base units (6 decimals)
    uint256 public immutable maxStake;

    mapping(bytes32 => Duel) private duels;
    mapping(bytes32 => mapping(address => bool)) public deposited;

    event Created(bytes32 indexed duelId, address indexed creator, uint256 stake, bytes32 termsHash);
    event Deposited(bytes32 indexed duelId, address indexed who);
    event Joined(bytes32 indexed duelId, address indexed who);
    event Activated(bytes32 indexed duelId);
    event Settled(bytes32 indexed duelId, address[] winners, bytes32 settlementHash);
    event Refunded(bytes32 indexed duelId);

    error NotParticipant();
    error BadState();
    error BadParams();
    error BadSignature();

    constructor(IERC20 _usdc, address _oracle, uint256 _minStake, uint256 _maxStake) {
        if (address(_usdc) == address(0) || _oracle == address(0)) revert BadParams();
        if (_minStake == 0 || _maxStake < _minStake) revert BadParams();
        usdc = _usdc;
        oracle = _oracle;
        minStake = _minStake;
        maxStake = _maxStake;
    }

    /// creator registers the duel and pays their stake in the same call.
    /// participants may contain address(0) for open slots (an invitee or a public
    /// challenger whose wallet isn't known yet). open slots are filled with `join`.
    function createDuel(bytes32 duelId, uint256 stake, address[] calldata participants, bytes32 termsHash) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.None) revert BadState();
        if (stake < minStake || stake > maxStake) revert BadParams();
        uint256 n = participants.length;
        if (n < 2 || n > MAX_PARTICIPANTS) revert BadParams();
        bool creatorIn;
        for (uint256 i; i < n; i++) {
            address p = participants[i];
            if (p == address(0)) continue; // open slot
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

    /// fills an open slot and deposits. the beef oracle authorises which wallet may
    /// take a slot (the invited friend, or whoever accepted a public challenge), so a
    /// stranger can't grab a seat.
    function join(bytes32 duelId, bytes calldata oracleSig) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.Funding || block.timestamp > d.fundingDeadline) revert BadState();
        if (_isParticipant(d, msg.sender)) revert BadState();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(joinDigest(duelId, msg.sender));
        if (ECDSA.recover(digest, oracleSig) != oracle) revert BadSignature();
        uint256 n = d.participants.length;
        uint256 i;
        while (i < n && d.participants[i] != address(0)) i++;
        if (i == n) revert BadState(); // no open slot left
        d.participants[i] = msg.sender;
        emit Joined(duelId, msg.sender);
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

    /// a price result for one duel, produced by beef's settlement relay from chainlink data
    /// feeds on base mainnet and signed by the oracle key. arrays follow participant order.
    struct Result {
        uint256[] startPrices;   // 18-decimal prices
        uint256[] endPrices;
        uint64[] startTimes;     // chainlink round updatedAt of each observation
        uint64[] endTimes;
        uint64 startAt;          // agreed start (market open after activation)
        uint64 endAt;            // agreed deadline
        uint64 maxDelay;         // observations must fall in [agreed time, agreed time + maxDelay]
        bytes32 evidenceHash;    // hash of feed addresses, round ids, raw answers (stored offchain)
    }

    uint64 public constant MAX_RESOLUTION_DELAY = 1 days;

    /// pays out a signed price result. the contract checks the signer, the duel, the
    /// participants, every price and timestamp and the agreed window, then works out the
    /// winner itself (higher percentage return; equal at 0.0001 points = draw). once only.
    function settleWithPrices(bytes32 duelId, Result calldata r, bytes calldata oracleSig) external {
        Duel storage d = duels[duelId];
        if (d.status != Status.Active) revert BadState();
        uint256 n = d.participants.length;
        if (r.startPrices.length != n || r.endPrices.length != n || r.startTimes.length != n || r.endTimes.length != n) revert BadParams();
        if (r.endAt <= r.startAt || r.endAt > block.timestamp || r.maxDelay > MAX_RESOLUTION_DELAY) revert BadParams();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(resultDigest(duelId, r));
        if (ECDSA.recover(digest, oracleSig) != oracle) revert BadSignature();

        int256 best = type(int256).min;
        int256[] memory c = new int256[](n);
        for (uint256 i; i < n; i++) {
            if (r.startPrices[i] == 0 || r.endPrices[i] == 0) revert BadParams();
            if (r.startTimes[i] < r.startAt || r.startTimes[i] > r.startAt + r.maxDelay) revert BadParams();
            if (r.endTimes[i] < r.endAt || r.endTimes[i] > r.endAt + r.maxDelay) revert BadParams();
            // percent × 1e4, truncated toward zero (same as beef's bigint engine)
            c[i] = ((int256(r.endPrices[i]) - int256(r.startPrices[i])) * 1e8 / int256(r.startPrices[i])) / 100;
            if (c[i] > best) best = c[i];
        }
        uint256 count;
        for (uint256 i; i < n; i++) if (c[i] == best) count++;
        address[] memory winners = new address[](count == n ? 0 : count);
        if (count != n) {
            uint256 k;
            for (uint256 i; i < n; i++) if (c[i] == best) winners[k++] = d.participants[i];
        }
        _payout(duelId, d, winners, r.evidenceHash);
    }

    function resultDigest(bytes32 duelId, Result calldata r) public view returns (bytes32) {
        Duel storage d = duels[duelId];
        return keccak256(abi.encode("beef.settle.v3", block.chainid, address(this), duelId, d.termsHash, d.participants, r));
    }

    function _payout(bytes32 duelId, Duel storage d, address[] memory winners, bytes32 evidenceHash) private {
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
        emit Settled(duelId, winners, evidenceHash);
    }

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

    /// the message the oracle signs to let `who` take an open slot in `duelId`
    function joinDigest(bytes32 duelId, address who) public view returns (bytes32) {
        return keccak256(abi.encode("beef.join", block.chainid, address(this), duelId, who));
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
