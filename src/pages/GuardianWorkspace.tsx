import React, { useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  LockKeyhole,
  Clock3,
  UsersRound,
  ArrowRight,
  ArrowUpRight,
  Search,
  Activity,
  Sprout,
  ChevronRight,
  CircleHelp,
  FolderLock,
  Gift,
  CheckCircle,
  AlertTriangle,
  FileCheck2,
  Send,
  Info,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import UserMenu from '../components/UserMenu';
import { RecoveryPolicyStatus } from '../components/SuccessionGraph';
import { isBeneficiary, selectedRecipient } from '../lib/workspace-policy';
import { useRouter } from '../lib/router';
import type { Config, Actor, Vault, TimelineEvent, IdentityRecord } from '../lib/types';
import { formatActorName, type UserAccount } from '../lib/auth';

interface GuardianWorkspaceProps {
  currentUser: UserAccount;
  actor: Actor;
  config: Config;
  identities?: IdentityRecord[];
  vaults: Vault[];
  events: TimelineEvent[];
  time: number;
  block: number;
  busy: string;
  offline: boolean;
  onRefresh: () => Promise<void>;
  onSelectVault: (vaultId: string) => void;
  onApproveRecovery: (vault: Vault) => Promise<void>;
  onReleaseShare: (vault: Vault) => Promise<void>;
  onInspectTx: (hash: string) => Promise<void>;
  onOpenHelp: () => void;
  onLogout: () => void;
}

const short = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;
const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase();

function duration(seconds: number) {
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} days`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.max(0, Math.ceil(seconds))} sec`;
}

export default function GuardianWorkspace({
  currentUser,
  actor,
  config,
  identities,
  vaults,
  events,
  time,
  block,
  busy,
  offline,
  onRefresh,
  onSelectVault,
  onApproveRecovery,
  onReleaseShare,
  onInspectTx,
  onOpenHelp,
  onLogout,
}: GuardianWorkspaceProps) {
  const { path, navigate } = useRouter();

  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState('');

  async function perform(action: (vault: Vault) => Promise<void>, vault: Vault) {
    setActionError('');
    try { await action(vault); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to confirm guardian action. Refresh and try again.'); }
  }

  // Filter vaults where connected wallet is one of the designated guardians
  const guardianVaults = vaults.filter(v =>
    v.state.guardians.some(g => same(g, currentUser.address))
  );
  const ownedVaults = vaults.filter(v => same(v.state.owner, currentUser.address));
  const beneficiaryVaults = vaults.filter(v => isBeneficiary(v.state, currentUser.address));

  // Determine active tab
  const activeTab: 'inbox' | 'vaults' | 'activity' = path.includes('/vaults')
    ? 'vaults'
    : path.includes('/activity')
    ? 'activity'
    : 'inbox';

  // Pending attestations: in recovery (status 1) and this guardian has NOT approved yet
  const pendingAttestations = guardianVaults.filter(
    v => v.state.status === 1 && !v.state.approved.some(a => same(a, currentUser.address))
  );

  const alreadyApproved = guardianVaults.filter(
    v => v.state.status === 1 && v.state.approved.some(a => same(a, currentUser.address))
  );

  const finalizedReleases = guardianVaults.filter(v => v.state.status === 2 && v.state.approved.some(a => same(a, currentUser.address)));

  const visibleVaults = guardianVaults.filter(
    v =>
      !search ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.category.toLowerCase().includes(search.toLowerCase())
  );

  function nameOf(address: string) {
    if (same(currentUser.address, address)) return formatActorName(currentUser.name);
    const fromIdentity = identities?.find(i => same(i.address, address))?.name;
    if (fromIdentity) return formatActorName(fromIdentity);
    const found = config.actors.find(a => same(a.address, address));
    return found ? formatActorName(found.name) : short(address);
  }

  return (
    <div className="app-shell">
      {/* Sidebar for Guardian */}
      <aside className="sidebar">
        <div onClick={() => navigate('/guardian')} style={{ cursor: 'pointer' }}>
          <Brand />
        </div>

        <div className="workspace">
          <span className="workspace-icon guardian-theme">
            <KeyRound size={18} />
          </span>
          <div>
            Trusted Guardian<small>Independent Custodian</small>
          </div>
        </div>

        <span className="nav-caption">GUARDIAN WORKSPACE</span>
        <nav>
          <button
            type="button"
            className={activeTab === 'inbox' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/guardian')}
          >
            <ShieldCheck size={19} />
            Attestation Inbox
            {pendingAttestations.length > 0 && (
              <span className="nav-count amber">{pendingAttestations.length}</span>
            )}
          </button>

          <button
            type="button"
            className={activeTab === 'vaults' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/guardian/vaults')}
          >
            <KeyRound size={19} />
            Guarded Vaults
            <span className="nav-total">{guardianVaults.length}</span>
          </button>

          <button
            type="button"
            className={activeTab === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/guardian/activity')}
          >
            <Activity size={19} />
            Attestation History
          </button>
        </nav>

        {/* Cross-Role "Assigned to me" Section */}
        {(ownedVaults.length > 0 || beneficiaryVaults.length > 0) && (
          <div className="sidebar-cross-role-box">
            <span className="nav-caption">ASSIGNED TO ME</span>
            {ownedVaults.length > 0 && (
              <button
                type="button"
                className="cross-role-link-btn"
                onClick={() => navigate('/owner')}
              >
                <FolderLock size={15} />
                <span>Owner for {ownedVaults.length} vault(s)</span>
                <ChevronRight size={13} />
              </button>
            )}
            {beneficiaryVaults.length > 0 && (
              <button
                type="button"
                className="cross-role-link-btn"
                onClick={() => navigate('/beneficiary')}
              >
                <Gift size={15} />
                <span>Beneficiary for {beneficiaryVaults.length} vault(s)</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-note">
          <span className="note-spark">✳</span>
          <h4>Guardian responsibility.</h4>
          <p>
            Independently verify circumstances off-chain before approving. The contract records approvals; it does not prove death or incapacity.
          </p>
          <button type="button" onClick={onOpenHelp}>
            Guardian Duties <ArrowUpRight size={14} />
          </button>
        </div>

        <button type="button" className="sidebar-help" onClick={onOpenHelp}>
          <CircleHelp size={18} /> Help & protocol guide
          <ArrowUpRight size={14} />
        </button>

        <div className="sidebar-account">
          <span className="avatar">{currentUser.initials}</span>
          <div>
            {currentUser.name}
            <small>Guardian · {short(currentUser.address)}</small>
          </div>
        </div>
      </aside>

      {/* Main Shell */}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Guardian</span>
            <ChevronRight size={13} />
            <strong>
              {activeTab === 'inbox'
                ? 'Attestation Inbox'
                : activeTab === 'activity'
                ? 'Attestation History'
                : 'Guarded Vaults'}
            </strong>
          </div>

          <div className="topbar-right">
            <div className="wallet-badge-pill">
              <span className="online-dot" />
              <span>Wallet: <code>{short(currentUser.address)}</code></span>
            </div>

            <UserMenu currentUser={currentUser} onLogout={onLogout} />
          </div>
        </header>

        <main>
          {actionError && <div className="inline-error" role="alert">{actionError}</div>}
          {offline && <div className="inline-error" role="status">Chain connection unavailable. Showing the last confirmed state; refresh before taking action.</div>}
          {/* Heading */}
          <div className="page-heading">
            <div>
              <span className="eyebrow">TRUSTED GUARDIAN WORKSPACE</span>
              <h1>
                {activeTab === 'inbox'
                  ? 'Pending recovery attestations'
                  : activeTab === 'activity'
                  ? 'Guardian attestation log'
                  : 'Vaults in your custody'}
              </h1>
              <p>
                {activeTab === 'inbox'
                  ? 'Review beneficiary requests and sign attestation only after independent verification.'
                  : activeTab === 'activity'
                  ? 'Verifiable record of your signed guardian approvals and encrypted share releases.'
                  : 'You hold 1-of-3 encrypted key shares for these vaults. Two guardian approvals are required for quorum.'}
              </p>
            </div>
          </div>

          {/* Stats Bar */}
          <section className="stats-grid">
            <div className="stat-card">
              <span className="stat-icon lilac">
                <KeyRound size={20} />
              </span>
              <div>
                <span>Guarded vaults</span>
                <strong>
                  {guardianVaults.length.toString().padStart(2, '0')}
                  <small>entrusted to your care</small>
                </strong>
              </div>
            </div>

            <div className="stat-card">
              <span className="stat-icon peach">
                <ShieldCheck size={20} />
              </span>
              <div>
                <span>Pending attestations</span>
                <strong>
                  {pendingAttestations.length.toString().padStart(2, '0')}
                  <small>{pendingAttestations.length ? 'awaiting your review' : 'inbox clear'}</small>
                </strong>
              </div>
              <span className={`stat-dot ${pendingAttestations.length ? 'amber' : ''}`} />
            </div>

            <div className="stat-card">
              <span className="stat-icon sage">
                <CheckCircle size={20} />
              </span>
              <div>
                <span>Finalized requests</span>
                <strong>
                  {finalizedReleases.length.toString().padStart(2, '0')}
                  <small>approved for share release</small>
                </strong>
              </div>
              <span className={`stat-dot ${finalizedReleases.length ? 'green' : ''}`} />
            </div>
          </section>

          {/* Subview: Inbox */}
          {activeTab === 'inbox' && (
            <div className="guardian-inbox-panel">
              {pendingAttestations.length > 0 ? (
                <div className="pending-attestations-list">
                  {pendingAttestations.map(v => (
                    <div className="attestation-card" key={v.state.id}>
                      <div className="attestation-card-header">
                        <span className="asset-icon color-1">
                          <AlertTriangle size={22} className="text-warning" />
                        </span>
                        <div>
                          <h3>Recovery Requested: {v.label}</h3>
                          <p>
                            Owner: <strong>{nameOf(v.state.owner)}</strong> ({short(v.state.owner)}) ·
                            Selected recipient: <strong>{nameOf(selectedRecipient(v.state))}</strong>
                          </p>
                        </div>
                        <span className="status-badge status-1">Attestation Required</span>
                      </div>

                      <div className="attestation-details-box">
                        <p>
                          <strong>Independent verification:</strong> Verify the owner’s circumstances off-chain
                          before approving this request and its selected recipient. The contract records your
                          approval; it does not establish death or incapacity. Two approvals start the full
                          owner cancellation window.
                        </p>
                        <div className="attestation-meta-row">
                          <span>Request ID: #{v.state.requestId}</span>
                          <span>Quorum: {v.state.approvalCount} / 2 approvals</span>
                          <span>Challenge window: {duration(v.state.challenge)}</span>
                        </div>
                        <RecoveryPolicyStatus vault={v} time={time} block={block} offline={offline} nameOf={nameOf}/>
                      </div>

                      <div className="attestation-card-actions">
                        <button
                          type="button"
                          className="button primary"
                          disabled={!!busy || offline}
                          onClick={() => perform(onApproveRecovery, v)}
                        >
                          <FileCheck2 size={16} />
                          Attest & Confirm Approval
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => onSelectVault(v.state.id)}
                        >
                          Inspect Full Policy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="large-empty">
                  <ShieldCheck size={36} />
                  <h3>Your guardian inbox is clear.</h3>
                  <p>
                    No recovery requests currently require your attestation. When a designated beneficiary
                    opens a claim on a vault you guard, it will appear here.
                  </p>
                </div>
              )}

              {/* Already Approved or Finalized Section */}
              {(alreadyApproved.length > 0 || finalizedReleases.length > 0) && (
                <div className="guardian-ongoing-section">
                  <div className="section-heading">
                    <h2>Your Active Attestations & Releases</h2>
                  </div>

                  <div className="ongoing-claims-grid">
                    {alreadyApproved.map(v => (
                      <div className="ongoing-card" key={v.state.id}>
                        <div className="ongoing-card-top">
                          <strong>{v.label}</strong>
                          <span className="approved-check">
                            <CheckCircle size={13} />
                            Approval Confirmed
                          </span>
                        </div>
                        <p>
                          Quorum: {v.state.approvalCount} / 2 approvals.
                          {v.state.quorumAt
                            ? ` ${time >= v.state.quorumAt + v.state.challenge ? 'Cancellation window elapsed in the confirmed block.' : `Cancellation window has ${duration(v.state.quorumAt + v.state.challenge - time)} remaining at the confirmed block.`}`
                            : ' Waiting for second guardian.'}
                        </p>
                        <RecoveryPolicyStatus vault={v} time={time} block={block} offline={offline} nameOf={nameOf}/>
                      </div>
                    ))}

                    {finalizedReleases.map(v => (
                      <div className="ongoing-card finalized" key={v.state.id}>
                        <div className="ongoing-card-top">
                          <strong>{v.label}</strong>
                          <span className="status-badge status-2">Recovery Finalized</span>
                        </div>
                        <p>
                          Recovery finalized for {nameOf(selectedRecipient(v.state))}. Deliver your encrypted key share only to this selected recipient.
                        </p>
                        <RecoveryPolicyStatus vault={v} time={time} block={block} offline={offline} nameOf={nameOf}/>
                        <button
                          type="button"
                          className="button primary small-button"
                          disabled={!!busy || offline}
                          onClick={() => perform(onReleaseShare, v)}
                        >
                          <Send size={13} />
                          Release Encrypted Share
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subview: Guarded Vaults */}
          {activeTab === 'vaults' && (
            <>
              <div className="asset-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    placeholder="Search guarded vaults…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {visibleVaults.length > 0 ? (
                <div className="vault-grid">
                  {visibleVaults.map(v => {
                    const isApprovedByMe = v.state.approved.some(a => same(a, currentUser.address));
                    const isFinalized = v.state.status === 2;

                    return (
                      <div className="vault-card" key={v.state.id} onClick={() => onSelectVault(v.state.id)}>
                        <div className="card-top">
                          <span className="asset-icon color-2">
                            <KeyRound size={22} />
                          </span>
                          <span className={`status-badge status-${v.state.status}`}>
                            <span />
                            {v.state.status === 2 ? 'Finalized' : v.state.status === 1 ? 'Recovery in progress' : 'Protected'}
                          </span>
                        </div>
                        <h3>{v.label}</h3>
                        <p>Owner: {nameOf(v.state.owner)}</p>

                        <div className="card-policy">
                          <span>
                            <UsersRound size={14} /> 2 of 3 quorum
                          </span>
                          <span>
                            {isApprovedByMe ? '✓ You approved' : v.state.status === 0 ? 'Waiting for claim' : 'You have not approved'}
                          </span>
                        </div>

                        <div className="card-bottom">
                          <span>{v.state.status === 0 ? 'Primary: ' : 'Selected: '}<strong>{nameOf(v.state.status === 0 ? v.state.beneficiary : selectedRecipient(v.state))}</strong></span>
                          <ArrowUpRight size={17} />
                        </div>
                        <RecoveryPolicyStatus vault={v} time={time} block={block} offline={offline} nameOf={nameOf}/>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-vault">
                  <span className="empty-art">
                    <KeyRound size={30} />
                  </span>
                  <div>
                    <h3>No guarded vaults found.</h3>
                    <p>
                      {search
                        ? 'No vaults match your search filter.'
                        : `Your wallet (${short(currentUser.address)}) is not currently configured as a guardian on any active vaults.`}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Subview: Activity */}
          {activeTab === 'activity' && (
            <div className="all-activity">
              <div className="section-heading">
                <h2>Guardian History</h2>
              </div>
              {events.filter(e => guardianVaults.some(v => v.state.id === e.vaultId)).length ? (
                events
                  .filter(e => guardianVaults.some(v => v.state.id === e.vaultId))
                  .map((e, i) => (
                    <button
                      type="button"
                      className="activity-row"
                      key={`${e.hash}-${e.name}-${i}`}
                      onClick={() => onInspectTx(e.hash)}
                    >
                      <span className="event-icon">
                        <KeyRound size={17} />
                      </span>
                      <span className="event-copy">
                        <strong>{e.name}</strong>
                        <small>
                          {guardianVaults.find(v => v.state.id === e.vaultId)?.label ?? short(e.vaultId)}
                        </small>
                      </span>
                      <span className="event-time">
                        Block #{e.blockNumber}
                        <small>{short(e.hash)}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))
              ) : (
                <div className="large-empty">
                  <Activity size={32} />
                  <h3>No activity recorded yet for guarded vaults.</h3>
                </div>
              )}
            </div>
          )}

          <footer className="page-footer">
            <span>
              <Sprout size={14} />
              Heirloom Protocol · Trusted Guardian Space
            </span>
            <button type="button" onClick={onOpenHelp}>
              Protocol Guide <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
