// Comprehensive End-to-End Verification of Heirloom Three Workspaces & Contract Enforcements
import { strictEqual, ok } from 'node:assert';
import { JsonRpcProvider, Contract, id } from 'ethers';
import { readFileSync } from 'node:fs';

const RELAY_URL = 'http://127.0.0.1:3001';
const RPC_URL = 'http://127.0.0.1:8545';

async function main() {
  console.log('===============================================================');
  console.log('STARTING END-TO-END WORKSPACES & CONTRACT VERIFICATION');
  console.log('===============================================================\n');

  // 1. Fetch Relay Config and Contract ABI
  console.log('--- 1. Relay Config & Contract Connection ---');
  const configRes = await fetch(`${RELAY_URL}/api/config`);
  strictEqual(configRes.status, 200);
  const config = await configRes.json();
  console.log(`✓ Active Contract Address: ${config.contractAddress}`);
  console.log(`✓ Network Mode: ${config.mode}, Chain ID: ${config.chainId}`);

  const provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
  const signers = await Promise.all(Array.from({ length: 5 }, (_, i) => provider.getSigner(i)));
  const [ownerSigner, beneficiarySigner, guardian1Signer, guardian2Signer, guardian3Signer] = signers;

  const artifact = JSON.parse(readFileSync('artifacts/Heirloom.json', 'utf8'));
  const contract = new Contract(config.contractAddress, artifact.abi, provider);

  // 2. Register a new test vault for testing the 3 workspace flows
  console.log('\n--- 2. [Owner Workspace] Vault Registration & Check-In ---');
  const vaultId = id(`workspace-test-vault-${Date.now()}`);
  const beneficiaryAddr = await beneficiarySigner.getAddress();
  const g1Addr = await guardian1Signer.getAddress();
  const g2Addr = await guardian2Signer.getAddress();
  const g3Addr = await guardian3Signer.getAddress();
  const guardians = [g1Addr, g2Addr, g3Addr];

  const regTx = await contract.connect(ownerSigner).registerVault(
    vaultId,
    beneficiaryAddr,
    guardians,
    60, // 60s inactivity
    30, // 30s challenge
    id('encrypted-payload-sample'),
    id('beneficiary-pubkey-sample')
  );
  await regTx.wait();
  console.log('✓ Vault successfully registered on-chain by Owner:', vaultId.slice(0, 18) + '…');

  // Verify vault initial state
  let vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.status), 0, 'Initial status should be Active (0)');
  const initialCheckIn = Number(vaultState.lastCheckIn);
  console.log('✓ Initial lastCheckIn on-chain timestamp:', initialCheckIn);

  // Owner workspace check-in
  await provider.send('evm_increaseTime', [10]);
  await provider.send('evm_mine', []);
  const checkInTx = await contract.connect(ownerSigner).checkIn(vaultId);
  await checkInTx.wait();
  vaultState = await contract.getVault(vaultId);
  ok(Number(vaultState.lastCheckIn) > initialCheckIn, 'lastCheckIn must increase after checkIn');
  console.log('✓ [Owner Workspace] checkIn succeeded! New timestamp:', Number(vaultState.lastCheckIn));

  // Verify Permission Enforcement: non-owner cannot checkIn
  try {
    await contract.connect(beneficiarySigner).checkIn.staticCall(vaultId);
    ok(false, 'Non-owner checkIn must fail');
  } catch (err) {
    ok(String(err).includes('Unauthorized'), 'Contract properly rejected non-owner checkIn');
    console.log('✓ [Owner Security] Non-owner checkIn rejected by contract (Unauthorized)');
  }

  // 3. Beneficiary Workspace: Recovery Request
  console.log('\n--- 3. [Beneficiary Workspace] Recovery Request & Eligibility ---');
  // Premature recovery request should fail (owner is still active)
  try {
    await contract.connect(beneficiarySigner).requestRecovery.staticCall(vaultId);
    ok(false, 'Premature recovery request must fail');
  } catch (err) {
    ok(String(err).includes('OwnerStillActive'), 'Contract properly rejected premature recovery');
    console.log('✓ [Beneficiary Security] Premature recovery rejected (OwnerStillActive)');
  }

  // Fast-forward 65 seconds past inactivity interval
  await provider.send('evm_increaseTime', [65]);
  await provider.send('evm_mine', []);

  // Beneficiary workspace submits recovery request
  const reqTx = await contract.connect(beneficiarySigner).requestRecovery(vaultId);
  await reqTx.wait();
  vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.status), 1, 'Status should be RecoveryPending (1)');
  const currentRequestId = Number(vaultState.requestId);
  console.log(`✓ [Beneficiary Workspace] requestRecovery succeeded on-chain! Status: RecoveryPending (1), Request ID: #${currentRequestId}`);

  // Unauthorized actor (guardian or stranger) cannot submit beneficiary recovery
  try {
    await contract.connect(guardian1Signer).requestRecovery.staticCall(vaultId);
    ok(false, 'Non-beneficiary requestRecovery must fail');
  } catch (err) {
    ok(String(err).includes('Unauthorized'), 'Contract properly rejected non-beneficiary request');
    console.log('✓ [Beneficiary Security] Non-beneficiary requestRecovery rejected (Unauthorized)');
  }

  // 4. Guardian Workspace: Attestation & Quorum
  console.log('\n--- 4. [Guardian Workspace] Independent Attestation & Quorum ---');
  // Guardian 1 attests
  const g1Tx = await contract.connect(guardian1Signer).approveRecovery(vaultId, currentRequestId);
  await g1Tx.wait();
  vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.approvalCount), 1, 'Approval count should be 1');
  console.log('✓ [Guardian Workspace] Guardian 1 attestation confirmed! Approvals: 1 of 2');

  // Guardian cannot approve twice
  try {
    await contract.connect(guardian1Signer).approveRecovery.staticCall(vaultId, currentRequestId);
    ok(false, 'Duplicate guardian approval must fail');
  } catch (err) {
    ok(String(err).includes('AlreadyApproved'), 'Contract properly rejected duplicate approval');
    console.log('✓ [Guardian Security] Duplicate guardian vote rejected (AlreadyApproved)');
  }

  // Stranger cannot approve
  try {
    const strangerSigner = await provider.getSigner(6);
    await contract.connect(strangerSigner).approveRecovery.staticCall(vaultId, currentRequestId);
    ok(false, 'Unauthorized guardian approval must fail');
  } catch (err) {
    ok(String(err).includes('Unauthorized'), 'Contract properly rejected non-guardian');
    console.log('✓ [Guardian Security] Non-guardian approval rejected (Unauthorized)');
  }

  // Guardian 2 attests -> Quorum reached (2 of 3)
  const g2Tx = await contract.connect(guardian2Signer).approveRecovery(vaultId, currentRequestId);
  await g2Tx.wait();
  vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.approvalCount), 2, 'Approval count should be 2 (Quorum reached)');
  ok(Number(vaultState.quorumAt) > 0, 'quorumAt timestamp must be set');
  console.log('✓ [Guardian Workspace] Guardian 2 attestation confirmed! Quorum reached (2/3). Challenge window started.');

  // 5. Owner Cancellation during Challenge Window
  console.log('\n--- 5. [Owner Workspace] Prominent Challenge Window & Cancellation ---');
  console.log('Owner notices active challenge and submits check-in to cancel recovery claim...');
  const cancelTx = await contract.connect(ownerSigner).checkIn(vaultId);
  await cancelTx.wait();
  vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.status), 0, 'Status should return to Active (0)');
  strictEqual(Number(vaultState.approvalCount), 0, 'Approval count reset to 0');
  console.log('✓ [Owner Workspace] Owner check-in successfully cancelled recovery claim! Status restored to Active (0).');

  // 6. Beneficiary & Guardian Re-Run to Finalization & Local Decryption
  console.log('\n--- 6. [End-to-End Recovery Finalization Flow] ---');
  // Fast-forward past inactivity again
  await provider.send('evm_increaseTime', [65]);
  await provider.send('evm_mine', []);
  const req2Tx = await contract.connect(beneficiarySigner).requestRecovery(vaultId);
  await req2Tx.wait();
  const reqId2 = Number((await contract.getVault(vaultId)).requestId);
  console.log(`✓ Beneficiary opened recovery request #${reqId2}`);

  // Guardians 2 and 3 approve
  await (await contract.connect(guardian2Signer).approveRecovery(vaultId, reqId2)).wait();
  await (await contract.connect(guardian3Signer).approveRecovery(vaultId, reqId2)).wait();
  console.log('✓ Guardians 2 and 3 approved request #2. Quorum reached.');

  // Fast-forward past challenge window (35s)
  await provider.send('evm_increaseTime', [35]);
  await provider.send('evm_mine', []);

  // Beneficiary finalizes recovery
  const finTx = await contract.connect(beneficiarySigner).finalizeRecovery(vaultId, reqId2);
  await finTx.wait();
  vaultState = await contract.getVault(vaultId);
  strictEqual(Number(vaultState.status), 2, 'Status should be Finalized (2)');
  console.log('✓ [Beneficiary Workspace] finalizeRecovery executed! Status: Released (2)');

  console.log('\n===============================================================');
  console.log('ALL WORKSPACE CONTRACT PERMISSION ENFORCEMENTS VERIFIED!');
  console.log('===============================================================\n');
}

main().catch(err => {
  console.error('E2E Verification failed:', err);
  process.exit(1);
});
