export function validateDeployment(saved, observed) {
  if (saved.chainId !== observed.chainId || !saved.deploymentId || saved.deploymentId !== observed.blockHash || !saved.codeHash || saved.codeHash !== observed.codeHash) throw new Error('Deployment identity changed. Restart the app with the correct network configuration.');
  return true;
}
export function validateFinality(e) {
  if (e.chainId !== e.expectedChainId || !Number.isSafeInteger(e.eventBlock) || e.receiptStatus !== 1 || !e.eventBlockHash || e.receiptBlockHash !== e.eventBlockHash || e.canonicalBlockHash !== e.eventBlockHash) throw new Error('Finalization is missing or reorganized. No share may be released.');
  if (e.tip - e.eventBlock + 1 < e.confirmations) throw new Error(`Wait for ${e.confirmations} canonical chain confirmations before releasing a share.`);
  return true;
}
