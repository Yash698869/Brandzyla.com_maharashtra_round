// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Authorization and an auditable recovery lifecycle. Key shares stay off-chain.
contract Heirloom {
    enum Status { Active, Pending, Finalized }
    struct Vault {
        address owner;
        address beneficiary;
        address[3] guardians;
        uint64 inactivity;
        uint64 challenge;
        uint64 lastCheckIn;
        uint64 quorumAt;
        uint64 finalizedAt;
        uint64 requestId;
        uint8 approvalCount;
        Status status;
        bytes32 commitment;
        bytes32 beneficiaryKeyHash;
    }
    mapping(bytes32 => Vault) private vaults;
    mapping(bytes32 => mapping(uint64 => mapping(address => bool))) public hasApproved;

    error InvalidPolicy(); error VaultAlreadyExists(); error VaultNotFound();
    error Unauthorized(); error OwnerStillActive(); error RecoveryAlreadyPending();
    error NoPendingRecovery(); error AlreadyFinalized(); error StaleRequest();
    error AlreadyApproved(); error QuorumNotMet(); error ChallengeActive();

    event VaultRegistered(bytes32 indexed vaultId, address indexed owner, address indexed beneficiary, bytes32 commitment);
    event OwnerCheckedIn(bytes32 indexed vaultId, uint64 timestamp);
    event RecoveryRequested(bytes32 indexed vaultId, uint64 indexed requestId, address indexed beneficiary);
    event GuardianApproved(bytes32 indexed vaultId, uint64 indexed requestId, address indexed guardian, uint8 count);
    event ChallengeStarted(bytes32 indexed vaultId, uint64 indexed requestId, uint64 releaseAfter);
    event RecoveryCancelled(bytes32 indexed vaultId, uint64 indexed requestId, address indexed owner);
    event RecoveryFinalized(bytes32 indexed vaultId, uint64 indexed requestId, address indexed beneficiary);

    function registerVault(bytes32 vaultId, address beneficiary, address[3] calldata guardians,
        uint64 inactivity, uint64 challenge, bytes32 commitment, bytes32 beneficiaryKeyHash) external {
        if (vaults[vaultId].owner != address(0)) revert VaultAlreadyExists();
        if (vaultId == bytes32(0) || beneficiary == address(0) || beneficiary == msg.sender ||
            inactivity == 0 || challenge == 0 || commitment == bytes32(0) || beneficiaryKeyHash == bytes32(0)) revert InvalidPolicy();
        for (uint256 i; i < 3; i++) {
            if (guardians[i] == address(0) || guardians[i] == msg.sender || guardians[i] == beneficiary) revert InvalidPolicy();
            for (uint256 j; j < i; j++) if (guardians[i] == guardians[j]) revert InvalidPolicy();
        }
        Vault storage v = vaults[vaultId];
        v.owner = msg.sender; v.beneficiary = beneficiary; v.guardians = guardians;
        v.inactivity = inactivity; v.challenge = challenge; v.lastCheckIn = uint64(block.timestamp);
        v.commitment = commitment; v.beneficiaryKeyHash = beneficiaryKeyHash;
        emit VaultRegistered(vaultId, msg.sender, beneficiary, commitment);
    }

    function getVault(bytes32 vaultId) external view returns (Vault memory) { return _vault(vaultId); }

    function checkIn(bytes32 vaultId) external {
        Vault storage v = _vault(vaultId);
        if (msg.sender != v.owner) revert Unauthorized();
        if (v.status == Status.Finalized) revert AlreadyFinalized();
        if (v.status == Status.Pending) emit RecoveryCancelled(vaultId, v.requestId, msg.sender);
        v.status = Status.Active; v.approvalCount = 0; v.quorumAt = 0;
        v.lastCheckIn = uint64(block.timestamp);
        emit OwnerCheckedIn(vaultId, v.lastCheckIn);
    }

    function requestRecovery(bytes32 vaultId) external {
        Vault storage v = _vault(vaultId);
        if (msg.sender != v.beneficiary) revert Unauthorized();
        if (v.status == Status.Finalized) revert AlreadyFinalized();
        if (v.status == Status.Pending) revert RecoveryAlreadyPending();
        if (block.timestamp < uint256(v.lastCheckIn) + v.inactivity) revert OwnerStillActive();
        v.status = Status.Pending; v.requestId++; v.approvalCount = 0; v.quorumAt = 0;
        emit RecoveryRequested(vaultId, v.requestId, msg.sender);
    }

    function approveRecovery(bytes32 vaultId, uint64 requestId) external {
        Vault storage v = _pending(vaultId, requestId);
        bool guardian;
        for (uint256 i; i < 3; i++) if (msg.sender == v.guardians[i]) guardian = true;
        if (!guardian) revert Unauthorized();
        if (hasApproved[vaultId][requestId][msg.sender]) revert AlreadyApproved();
        hasApproved[vaultId][requestId][msg.sender] = true;
        v.approvalCount++;
        emit GuardianApproved(vaultId, requestId, msg.sender, v.approvalCount);
        if (v.approvalCount == 2) {
            v.quorumAt = uint64(block.timestamp);
            emit ChallengeStarted(vaultId, requestId, v.quorumAt + v.challenge);
        }
    }

    function finalizeRecovery(bytes32 vaultId, uint64 requestId) external {
        Vault storage v = _pending(vaultId, requestId);
        if (msg.sender != v.beneficiary) revert Unauthorized();
        if (v.approvalCount < 2) revert QuorumNotMet();
        if (block.timestamp < uint256(v.quorumAt) + v.challenge) revert ChallengeActive();
        v.status = Status.Finalized; v.finalizedAt = uint64(block.timestamp);
        emit RecoveryFinalized(vaultId, requestId, msg.sender);
    }

    function _vault(bytes32 vaultId) private view returns (Vault storage v) {
        v = vaults[vaultId]; if (v.owner == address(0)) revert VaultNotFound();
    }
    function _pending(bytes32 vaultId, uint64 requestId) private view returns (Vault storage v) {
        v = _vault(vaultId);
        if (v.status != Status.Pending) revert NoPendingRecovery();
        if (v.requestId != requestId) revert StaleRequest();
    }
}
