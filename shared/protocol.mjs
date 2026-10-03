import { keccak256, toUtf8Bytes } from 'ethers';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value) { return keccak256(toUtf8Bytes(canonical(value))); }
export function keyHash(key) { return digest({ kty: key.kty, n: key.n, e: key.e }); }
export function identityMessage(config, address, publicKey) {
  return `Heirloom identity enrollment v2\n${canonical({ chainId: config.chainId, contract: config.contractAddress.toLowerCase(), deploymentId: config.deploymentId, address: address.toLowerCase(), keyHash: keyHash(publicKey) })}`;
}
export function releaseMessage(release) { return `Heirloom authorized share release v1\n${digest(release)}`; }
