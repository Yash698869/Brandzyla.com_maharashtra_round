// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Authorization and an auditable recovery lifecycle. Key shares stay off-chain.
contract Heirloom {
    enum Status { Active, Pending, Finalized }
    struct SuccessionPolicy {
        address beneficiary;
        address backupBeneficiary;
        address[3] guardians;
        uint64 inactivity;
        uint64 challenge;
        uint64 backupWaitingDuration;
        bytes32 beneficiaryKeyHash;
        bytes32 backupBeneficiaryKeyHash;
    }
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
        uint8 policyVersion;
        address backupBeneficiary;
        uint64 backupWaitingDuration;
        bytes32 backupBeneficiaryKeyHash;
        address selectedBeneficiary;
    }
    mapping(bytes32 => Vault) private vaults;
    mapping(bytes32 => mapping(uint64 => mapping(address => bool))) public hasApproved;

    error InvalidPolicy(); error VaultAlreadyExists(); error VaultNotFound();
    error Unauthorized(); error OwnerStillActive(); error RecoveryAlreadyPending();
    error NoPendingRecovery(); error AlreadyFinalized(); error StaleRequest();
    error AlreadyApproved(); error QuorumNotMet(); error ChallengeActive();

    event VaultRegistered(bytes32 indexed vaultId, address indexed owner, address indexed beneficiary, bytes32 commitment);
    event VaultPolicyRegistered(bytes32 indexed vaultId, uint8 policyVersion, address backupBeneficiary,
        uint64 backupWaitingDuration, bytes32 beneficiaryKeyHash, bytes32 backupBeneficiaryKeyHash);
    event OwnerCheckedIn(bytes32 indexed vaultId, uint64 timestamp);
    event RecoveryRequested(bytes32 indexed vaultId, uint64 indexed requestId, address indexed beneficiary);
    event GuardianApproved(bytes32 indexed vaultId, uint64 indexed requestId, address indexed guardian, uint8 count);
    event ChallengeStarted(bytes32 indexed vaultId, uint64 indexed requestId, uint64 releaseAfter);
    event RecoveryCancelled(bytes32 indexed vaultId, uint64 indexed requestId, address indexed owner);
    event RecoveryFinalized(bytes32 indexed vaultId, uint64 indexed requestId, address indexed beneficiary);

    function registerVault(bytes32 vaultId, address beneficiary, address[3] calldata guardians,
        uint64 inactivity, uint64 challenge, bytes32 commitment, bytes32 beneficiaryKeyHash) external {
        SuccessionPolicy memory policy = SuccessionPolicy(beneficiary, address(0), guardians, inactivity,
            challenge, 0, beneficiaryKeyHash, bytes32(0));
        _register(vaultId, policy, commitment, 1);
    }

    function registerSuccessionVault(bytes32 vaultId, SuccessionPolicy calldata policy, bytes32 commitment) external {
        _register(vaultId, policy, commitment, 2);
    }

    function _register(bytes32 vaultId, SuccessionPolicy memory policy, bytes32 commitment, uint8 policyVersion) private {
        if (vaults[vaultId].owner != address(0)) revert VaultAlreadyExists();
        if (vaultId == bytes32(0) || policy.beneficiary == address(0) || policy.beneficiary == msg.sender ||
            policy.inactivity == 0 || policy.challenge == 0 || commitment == bytes32(0) ||
            policy.beneficiaryKeyHash == bytes32(0)) revert InvalidPolicy();
        if (policy.backupBeneficiary == address(0)) {
            if (policy.backupWaitingDuration != 0 || policy.backupBeneficiaryKeyHash != bytes32(0)) revert InvalidPolicy();
        } else if (policy.backupBeneficiary == msg.sender || policy.backupBeneficiary == policy.beneficiary ||
            policy.backupWaitingDuration == 0 || policy.backupBeneficiaryKeyHash == bytes32(0) ||
            policy.backupBeneficiaryKeyHash == policy.beneficiaryKeyHash) revert InvalidPolicy();
        for (uint256 i; i < 3; i++) {
            if (policy.guardians[i] == address(0) || policy.guardians[i] == msg.sender ||
                policy.guardians[i] == policy.beneficiary || policy.guardians[i] == policy.backupBeneficiary) revert InvalidPolicy();
            for (uint256 j; j < i; j++) if (policy.guardians[i] == policy.guardians[j]) revert InvalidPolicy();
        }
        Vault storage v = vaults[vaultId];
        v.owner = msg.sender; v.beneficiary = policy.beneficiary; v.guardians = policy.guardians;
        v.inactivity = policy.inactivity; v.challenge = policy.challenge; v.lastCheckIn = uint64(block.timestamp);
        v.commitment = commitment; v.beneficiaryKeyHash = policy.beneficiaryKeyHash;
        v.policyVersion = policyVersion; v.backupBeneficiary = policy.backupBeneficiary;
        v.backupWaitingDuration = policy.backupWaitingDuration; v.backupBeneficiaryKeyHash = policy.backupBeneficiaryKeyHash;
        emit VaultRegistered(vaultId, msg.sender, policy.beneficiary, commitment);
        emit VaultPolicyRegistered(vaultId, policyVersion, policy.backupBeneficiary, policy.backupWaitingDuration,
            policy.beneficiaryKeyHash, policy.backupBeneficiaryKeyHash);
    }

    function getVault(bytes32 vaultId) external view returns (Vault memory) { return _vault(vaultId); }

    function checkIn(bytes32 vaultId) external {
        Vault storage v = _vault(vaultId);
        if (msg.sender != v.owner) revert Unauthorized();
        if (v.status == Status.Finalized) revert AlreadyFinalized();
        if (v.status == Status.Pending) emit RecoveryCancelled(vaultId, v.requestId, msg.sender);
        for (uint256 i; i < 3; i++) delete hasApproved[vaultId][v.requestId][v.guardians[i]];
        v.status = Status.Active; v.approvalCount = 0; v.quorumAt = 0;
        v.selectedBeneficiary = address(0);
        v.lastCheckIn = uint64(block.timestamp);
        emit OwnerCheckedIn(vaultId, v.lastCheckIn);
    }

    function requestRecovery(bytes32 vaultId) external {
        Vault storage v = _vault(vaultId);
        if (msg.sender != v.beneficiary && (v.backupBeneficiary == address(0) || msg.sender != v.backupBeneficiary)) revert Unauthorized();
        if (v.status == Status.Finalized) revert AlreadyFinalized();
        if (v.status == Status.Pending) revert RecoveryAlreadyPending();
        uint256 eligibleAt = uint256(v.lastCheckIn) + v.inactivity;
        if (msg.sender == v.backupBeneficiary) eligibleAt += v.backupWaitingDuration;
        if (block.timestamp < eligibleAt) revert OwnerStillActive();
        v.status = Status.Pending; v.requestId++; v.approvalCount = 0; v.quorumAt = 0;
        v.selectedBeneficiary = msg.sender;
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
        if (msg.sender != v.selectedBeneficiary) revert Unauthorized();
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
