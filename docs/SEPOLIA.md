# Public Sepolia deployment

## Recommended: sign with your browser wallet

1. Keep the local app running with `npm run dev`.
2. Request **Ethereum Sepolia** test ETH. [Alchemy's faucet](https://www.alchemy.com/faucets/ethereum-sepolia) currently has mainnet-balance/activity eligibility requirements. If it declines the request, use the [Ethereum Foundation's faucet directory](https://ethereum.org/developers/docs/networks/#sepolia). Do not send real ETH to obtain test ETH.
3. Open `http://127.0.0.1:5173/deploy.html` in the browser where your wallet extension is installed. The Codex in-app browser may not contain that extension.
4. Connect the wallet, switch to Sepolia, and click **Deploy Heirloom contract**. Review and sign the contract-creation transaction in your wallet. The page estimates gas and checks test ETH balance before submitting.
5. Once the receipt is confirmed, inspect the Etherscan transaction and download `heirloom-sepolia.json`. If confirmation times out, use **Check submitted deployment**; the page preserves the transaction hash across reload. Do not blindly deploy a duplicate.
6. In another terminal, run `npm run sepolia:import`. The default file is `Downloads/heirloom-sepolia.json`; pass a full path after `--` for a different location. The command verifies the public chain, canonical deployment block, successful creation receipt, contract address, and compiled runtime hash.
7. Run `npm run dev:sepolia`, then open `http://127.0.0.1:5174` in your wallet browser. The public app uses relay port 3002. The local backup remains on port 5173.

The default RPC is [PublicNode's Sepolia endpoint](https://ethereum.publicnode.com/?sepolia). An HTTPS Sepolia endpoint from another provider can be entered instead. A provider URL containing an API key is stored locally in the downloaded/runtime config; the relay does not send it to the public app.

## Enroll the five roles

The owner, beneficiary, and three guardians must use five distinct wallet addresses. Each account needs to connect and sign **Connect & enroll wallet** in the public app before creating a vault. Enrollment creates a non-extractable browser encryption key and binds its public key with a wallet signature. A wallet's signing key is not the encryption key.

For a one-laptop rehearsal, use five testnet accounts in the wallet and reconnect after switching accounts. Keep all accounts in the same browser profile/origin used to enroll them. This demonstrates distinct on-chain roles, not separate-device custody. Each account that sends contract transactions needs some Sepolia ETH; enrollment and encrypted share delivery use signatures and do not charge chain gas.

For a public live demo, choose **2 minutes · testnet rehearsal** for the missed check-in period and **1 minute · testnet rehearsal** for cancellation. These are real block-time waits enforced by the same contract. Defaults remain seven days / 24 hours. Public mode has no time skip. Wait for three confirmations after finalization before releasing shares.

The local relay currently binds to loopback. Teammates on separate devices cannot use it until authenticated HTTPS hosting and durable ciphertext storage are implemented and tested. The [separate-device design](SEPARATE-DEVICE.md) lists the required authorization and recovery checks. Do not claim independent-device validation from a single-browser demonstration.

## Optional CLI path

Use a disposable testnet account with only test ETH. Copy `.env.example` to `.env` and fill the values **locally**, not in chat. Then:

```powershell
node --env-file=.env scripts/deploy.mjs
npm run dev:sepolia
```

The CLI writes `.runtime/sepolia-deployment.json`, separate from the local chain config. `.env` and `.runtime` are ignored by Git. The wallet page is the preferred path because it does not export your wallet's private key.

## What judges can verify

- A real public contract address and confirmed deployment receipt on Sepolia Etherscan.
- Registration and recovery transactions signed by the configured roles.
- On-chain encrypted-package commitments and event history.
- The same cancellation and quorum rules used by the local demo.

Source-code verification on Etherscan is a separate optional step; the app verifies compiled runtime locally, but has not submitted a source verification request to Etherscan.
