# Heirloom — first judging round

## Before judges arrive

Keep `npm run dev` running. Open `http://127.0.0.1:5173` in the same browser profile used during setup. Load the sample vaults if the workspace is empty. Choose **Alex Morgan · owner**. Rehearse once, then create a fresh sample note for the live recovery: finalized vaults cannot be reset.

The existing “Letters for my family” vault is released from verification. It is useful as a ready-to-open proof. A fourth vault, “Judging demo”, is already registered and protected; find it under **My vaults**. “My digital instructions” remains protected after the cancellation verification. Check in as Alex before demonstrating an early denial on an older vault.

## Opening pitch — 20 seconds

“Digital inheritance has two failure modes: your family never gets access, or access is released while you are still here. Heirloom combines client-side encryption, shared custody, and on-chain recovery authorization. Neither our platform nor a single guardian holds enough information to decrypt your asset.”

## Live demo — approximately three minutes

1. **Create a vault as Alex.** Give it a label, add a sample private note, choose Sam and the three guardians, and use 60 seconds inactivity / 30 seconds cancellation. Click **Encrypt & create vault**. Show the on-chain commitment and unreadable storage ciphertext.
2. **Try too early as Sam.** Select Sam in the vault panel and click **Request recovery** immediately. The contract rejects it while Alex is active. Say: “The rule lives in Solidity, not just in a disabled button.” If you spent more than 60 seconds introducing it, first check in as Alex, then switch to Sam.
3. **Open a valid recovery.** Click **Skip inactivity**, explicitly saying that this is the local development-chain clock. Request recovery as Sam. Click **Finalize recovery** with no quorum; it fails.
4. **Collect independent approvals.** Switch to Maya and click **Attest & approve recovery**. Switch to Sam and try finalization: one guardian is insufficient. Switch to James and attest. Leave Priya untouched to demonstrate one unavailable guardian.
5. **Show the cancellation window.** As Sam, try finalization immediately after the second approval. It fails until the full challenge period finishes. Click **Skip challenge** and **Finalize recovery**.
6. **Deliver two encrypted shares.** As Maya, click **Release encrypted share**, then do the same as James. Switch to Sam and click **Decrypt inherited asset**. The exact original note appears. Say: “Decryption happened in the beneficiary’s browser. The relay still only has ciphertext.”
7. **Prove intervention.** Open a different protected vault, skip inactivity, request as Sam, and approve as Maya. Switch to Alex and click **I’m here — cancel recovery**. The vault becomes protected again and its effective quorum returns to zero.
8. **Show evidence.** Open **Activity log** and a transaction row. Show the confirmed receipt, block, gas used, actor, and contract address. If Sepolia is deployed, show its real Etherscan link as additional public proof.

## Questions worth answering directly

**Why blockchain?** It provides publicly verifiable authorization, timing and events, with no platform admin who can override the contract. Asset confidentiality comes from encryption and distributed custody.

**Can an inactivity timer unlock it?** No. It only permits a request. Two configured guardians must independently attest, then the full owner challenge window must expire.

**What if one guardian disappears?** Either pair of the three guardians can recover. In the live demo, Priya never participates.

**Can guardians collude?** A sufficient two-guardian quorum can collude off-chain. Heirloom minimizes single-party trust; it does not eliminate threshold collusion or prove death automatically.

**What would you build next?** Encrypted identity backup, separate-device custody, hosted ciphertext replication, guardian rotation, notification delivery, legal evidence adapters, and an external security review.

## Closing — 15 seconds

“We demonstrated exact asset recovery, a failed early attempt, an unavailable guardian, and owner cancellation. The contract controls authorization; cryptography protects the asset. The next phase makes independent custody and recovery resilience practical.”

## If the network fails during judging

Use the running local demo and clearly name it a local EVM. The interface marks stale connections and offers retry. Keep a screenshot of successful recovery and a previously confirmed receipt ready. Do not describe an undeployed public contract as deployed, and do not represent screenshots as a live transaction.
