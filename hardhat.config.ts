import { defineConfig } from 'hardhat/config';

export default defineConfig({
  solidity: '0.8.30',
  networks: { hardhat: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } },
});
