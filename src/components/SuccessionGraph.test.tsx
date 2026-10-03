import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SuccessionGraph from './SuccessionGraph';
import CreateVault from './CreateVault';
import BeneficiaryWorkspace from '../pages/BeneficiaryWorkspace';
import GuardianWorkspace from '../pages/GuardianWorkspace';
import OwnerWorkspace from '../pages/OwnerWorkspace';
import { RouterProvider } from '../lib/router';
import type { Actor, Config, Vault, VaultState } from '../lib/types';
import { getDefaultDemoUsers, type UserAccount } from '../lib/auth';

const primary = '0x1111111111111111111111111111111111111111';
const backup = '0x2222222222222222222222222222222222222222';
const owner = '0x3333333333333333333333333333333333333333';
const guardians = ['0x4444444444444444444444444444444444444444', '0x5555555555555555555555555555555555555555', '0x6666666666666666666666666666666666666666'];
const makeVault = (changes: Partial<VaultState> = {}): Vault => ({
  label: 'Family letters', category: 'Family memories', createdAt: 100,
  package: {} as Vault['package'],
  state: { id: 'vault', owner, beneficiary: primary, guardians, inactivity: 60, challenge: 30,
    lastCheckIn: 100, quorumAt: 0, finalizedAt: 0, requestId: 1, approvalCount: 0,
    status: 0, commitment: 'commitment', beneficiaryKeyHash: 'keyHash', approved: [],
    policyVersion: 2, backupBeneficiary: backup, backupWaitingDuration: 120, ...changes },
});
const nameOf = (address: string) => address === primary ? 'Primary heir' : address === backup ? 'Backup heir' : 'Owner';
const graph = (vault: Vault, time = 160, offline = false) => renderToStaticMarkup(
  <SuccessionGraph vault={vault} time={time} block={42} offline={offline} nameOf={nameOf}/>,
);
const account = (address: string, role: Actor['role']): UserAccount => ({ id: address, address, role, name: nameOf(address), initials: 'AA', email: '' });
const config: Config = { actors: [account(primary, 'beneficiary'), account(backup, 'beneficiary')], mode: 'local',
  chainId: 31337, contractAddress: owner, rpcUrl: 'http://127.0.0.1:8545', abi: [],
  deploymentBlock: 1, deploymentId: 'deployment', codeHash: 'codeHash', confirmations: 1 };
const noop = async () => {};

function beneficiary(vault: Vault, address = backup, time = 280, offline = false) {
  vi.stubGlobal('window', { location: { pathname: '/beneficiary', search: '' } });
  const currentUser = account(address, 'beneficiary');
  return renderToStaticMarkup(<RouterProvider><BeneficiaryWorkspace currentUser={currentUser} actor={currentUser} config={config}
    vaults={[vault]} events={[]} time={time} block={42} busy="" offline={offline}
    onRefresh={noop} onSelectVault={() => {}} onRequestRecovery={noop} onFinalizeRecovery={noop} onDecryptVault={noop}
    onInspectTx={noop} onOpenHelp={() => {}} onLogout={() => {}}/></RouterProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('succession graph and workspace controls', () => {
  it('shows a succession graph for every owned asset by default and excludes other owners', () => {
    vi.stubGlobal('window', { location: { pathname: '/owner', search: '' } });
    const currentUser = account(owner, 'owner');
    const letters = makeVault();
    const memories = { ...makeVault(), label: 'Family memories', state: { ...makeVault().state, id: 'memories' } };
    const unrelated = { ...makeVault(), label: 'Another owner asset', state: { ...makeVault().state, id: 'other', owner: guardians[0] } };
    const markup = renderToStaticMarkup(<RouterProvider><OwnerWorkspace currentUser={currentUser} actor={currentUser}
      config={config} identities={[]} vaults={[letters, memories, unrelated]} events={[]} time={280} block={42} busy="" offline={false}
      onRefresh={noop} onCreateVault={() => {}} onSelectVault={() => {}} onCheckIn={noop} onInspectTx={noop}
      onOpenHelp={() => {}} onLogout={() => {}}/></RouterProvider>);
    expect(markup).toContain('aria-label="Succession graph for Family letters"');
    expect(markup).toContain('aria-label="Succession graph for Family memories"');
    expect(markup).not.toContain('aria-label="Succession graph for Another owner asset"');
    expect(markup).toContain('<option value="" selected="">All assets</option>');
  });

  it('shows confirmed primary eligibility and the additional backup wait', () => {
    const markup = graph(makeVault());
    expect(markup).toContain('Succession Graph');
    expect(markup).toContain('Primary beneficiary');
    expect(markup).toContain('Optional backup');
    expect(markup).toContain('Eligible to request now');
    expect(markup).toContain('Waiting until');
    expect(markup).toContain('confirmed block #42');
  });

  it('never renders a backup path for a legacy vault', () => {
    const markup = graph(makeVault({ policyVersion: undefined }));
    expect(markup).not.toContain('Optional backup');
    expect(markup).toContain('Primary-only policy');
  });

  it('marks the frozen selected path and keeps the other recipient blocked', () => {
    const markup = graph(makeVault({ status: 1, selectedBeneficiary: backup }));
    expect(markup).toContain('Selected for request #1');
    expect(markup).toContain('Blocked by the pending request');
    expect(markup).toContain('Selected recipient:');
    expect(markup).toContain('Backup heir');
    expect(markup).not.toContain('Eligible to request now');
  });

  it('does not authorize from wall time or stale offline state', () => {
    expect(graph(makeVault(), 1000, true)).not.toContain('Eligible to request now');
    expect(beneficiary(makeVault(), backup, 279)).not.toContain('Request Recovery');
    expect(beneficiary(makeVault(), backup, 280)).toContain('Request Recovery');
    expect(beneficiary(makeVault(), backup, 1000, true)).not.toContain('Request Recovery');
  });

  it('shows backup assignments without offering displacement or another recipient’s finalize/decrypt', () => {
    const pending = makeVault({ status: 1, selectedBeneficiary: primary, approvalCount: 2, quorumAt: 200 });
    const pendingMarkup = beneficiary(pending);
    expect(pendingMarkup).toContain('You are the optional backup');
    expect(pendingMarkup).toContain('Another recipient holds this request');
    expect(pendingMarkup).not.toContain('Request Recovery');
    expect(pendingMarkup).not.toContain('Finalize Recovery');
    expect(beneficiary(makeVault({ status: 2, selectedBeneficiary: primary }))).not.toContain('Decrypt Inherited Asset');
    expect(beneficiary(makeVault({ status: 2, selectedBeneficiary: backup }))).toContain('Decrypt Inherited Asset');
  });

  it('gives the selected backup finalization only after quorum and the full challenge', () => {
    const vault = makeVault({ status: 1, selectedBeneficiary: backup, approvalCount: 2, quorumAt: 300 });
    expect(beneficiary(vault, backup, 329)).not.toContain('Finalize Recovery');
    expect(beneficiary(vault, backup, 330)).toContain('Finalize Recovery');
    expect(beneficiary(vault, primary, 330)).not.toContain('Finalize Recovery');
  });

  it('offers share release only to a guardian who approved the finalized request', () => {
    vi.stubGlobal('window', { location: { pathname: '/guardian', search: '' } });
    const currentUser = account(guardians[0], 'guardian');
    const render = (vault: Vault) => renderToStaticMarkup(<RouterProvider><GuardianWorkspace currentUser={currentUser}
      actor={currentUser} config={config} vaults={[vault]} events={[]} time={400} block={42} busy="" offline={false}
      onRefresh={noop} onSelectVault={() => {}} onApproveRecovery={noop} onReleaseShare={noop} onInspectTx={noop}
      onOpenHelp={() => {}} onLogout={() => {}}/></RouterProvider>);
    expect(render(makeVault({ status: 2, selectedBeneficiary: backup }))).not.toContain('Release Encrypted Share');
    const approvedMarkup = render(makeVault({ status: 2, selectedBeneficiary: backup, approved: guardians.slice(0, 2) }));
    expect(approvedMarkup).toContain('Release Encrypted Share');
    expect(approvedMarkup).toContain('Backup Heir');
  });

  it('disables creation on an old deployment while preserving recovery guidance', () => {
    const markup = renderToStaticMarkup(<CreateVault config={config} identities={[]} account={owner} busy="" onClose={() => {}} onCreate={noop}/>);
    expect(markup).toContain('Existing primary-only vaults remain recoverable. Deploy the new contract to create succession vaults.');
    expect(markup).toMatch(/<button class="button primary" disabled="">/);
  });

  it('includes the sixth backup actor in demo login while keeping five-actor deployments valid', () => {
    const actors = [account(owner, 'owner'), account(primary, 'beneficiary'), ...guardians.map(g => account(g, 'guardian')), { ...account(backup, 'beneficiary'), name: 'Taylor Morgan' }];
    expect(getDefaultDemoUsers(actors)).toHaveLength(6);
    expect(getDefaultDemoUsers(actors)[5]).toMatchObject({ name: 'Taylor Morgan', address: backup, role: 'beneficiary' });
    expect(getDefaultDemoUsers(actors.slice(0, 5))).toHaveLength(5);
  });
});
