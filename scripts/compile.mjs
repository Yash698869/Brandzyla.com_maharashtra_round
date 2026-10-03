import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import solc from 'solc';

export function compileContract() {
  const input = { language: 'Solidity', sources: { 'Heirloom.sol': { content: readFileSync('contracts/Heirloom.sol', 'utf8') } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const compiled = output.contracts['Heirloom.sol'].Heirloom;
  const artifact = { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}`, deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`, compiler: solc.version(), evmVersion: 'paris' };
  mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/Heirloom.json', JSON.stringify(artifact, null, 2));
  mkdirSync('public', { recursive: true }); writeFileSync('public/heirloom-contract.json', JSON.stringify(artifact));
  return artifact;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const a = compileContract(); console.log(`Heirloom compiled: ${a.bytecode.length / 2 - 1} bytes`); }
