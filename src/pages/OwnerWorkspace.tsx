import React, { useState } from 'react';
import {
  FolderLock,
  Plus,
  ShieldCheck,
  Fingerprint,
  UsersRound,
  LockKeyhole,
  Clock3,
  ArrowRight,
  ArrowUpRight,
  Search,
  Upload,
  Heart,
  KeyRound,
  FileText,
  Activity,
  CircleAlert,
  Sprout,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Gift,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { Brand, VaultIllustration } from '../components/Brand';
import UserMenu from '../components/UserMenu';
import SuccessionGraph from '../components/SuccessionGraph';
import { backupRecipient, isBeneficiary, selectedRecipient, policyDate } from '../lib/workspace-policy';
import { useRouter } from '../lib/router';
import type { Config, Actor, Vault, TimelineEvent, IdentityRecord } from '../lib/types';
import { formatActorName, type UserAccount } from '../lib/auth';

interface OwnerWorkspaceProps {
  currentUser: UserAccount;
  actor: Actor;
  config: Config;
  vaults: Vault[];
  events: TimelineEvent[];
  identities: IdentityRecord[];
  time: number;
  block: number;
  busy: string;
  offline: boolean;
  onRefresh: () => Promise<void>;
  onCreateVault: () => void;
  onSelectVault: (vaultId: string) => void;
  onCheckIn: (vault: Vault) => Promise<void>;
  onInspectTx: (hash: string) => Promise<void>;
  onOpenHelp: () => void;
  onLogout: () => void;
  onLoadSamples?: () => Promise<void>;
  onImportKit?: () => void;
}

const short = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;
const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase();

function duration(seconds: number) {
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} days`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.max(0, Math.ceil(seconds))} sec`;
}

const statusLabel = (v: Vault) =>
  v.state.status === 2 ? 'Released' : v.state.status === 1 ? 'Recovery pending' : 'Protected';

export default function OwnerWorkspace({
  currentUser,
  actor,
  config,
  vaults,
  events,
  identities,
  time,
  block,
  busy,
  offline,
  onRefresh,
  onCreateVault,
  onSelectVault,
  onCheckIn,
  onInspectTx,
  onOpenHelp,
  onLogout,
  onLoadSamples,
  onImportKit,
}: OwnerWorkspaceProps) {
  const { path, navigate } = useRouter();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All vaults');
  const [graphVaultId, setGraphVaultId] = useState('');
  const [actionError, setActionError] = useState('');

  async function checkIn(vault: Vault) {
    setActionError('');
    try { await onCheckIn(vault); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to confirm check-in. Refresh and try again.'); }
  }

  // Filter owned vaults
  const ownedVaults = vaults.filter(v => same(v.state.owner, currentUser.address));
  const beneficiaryVaults = vaults.filter(v => isBeneficiary(v.state, currentUser.address));
  const guardianVaults = vaults.filter(v => v.state.guardians.some(g => same(g, currentUser.address)));

  // Determine subpage
  const activeTab: 'vaults' | 'checkins' | 'activity' = path.includes('/checkins')
    ? 'checkins'
    : path.includes('/activity')
    ? 'activity'
    : 'vaults';

  // Check for any owned vault with active recovery challenge
  const activeChallenges = ownedVaults.filter(v => v.state.status === 1);
  const nextDeadlineVault = ownedVaults
    .filter(v => v.state.status === 0)
    .sort(
      (a, b) =>
        a.state.lastCheckIn + a.state.inactivity - (b.state.lastCheckIn + b.state.inactivity)
    )[0];

  const nextDeadlineSeconds = nextDeadlineVault
    ? Math.max(0, nextDeadlineVault.state.lastCheckIn + nextDeadlineVault.state.inactivity - time)
    : null;

  const visibleVaults = ownedVaults.filter(
    v =>
      (!search ||
        v.label.toLowerCase().includes(search.toLowerCase()) ||
        v.category.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'All vaults' || statusLabel(v) === filter)
  );
  const graphVaults = graphVaultId ? ownedVaults.filter(v => v.state.id === graphVaultId) : ownedVaults;

  const ownedEvents = events.filter(
    e => ownedVaults.some(v => v.state.id === e.vaultId) || same(e.actor, currentUser.address)
  );

  function nameOf(address: string) {
    if (same(currentUser.address, address)) return formatActorName(currentUser.name);
    const fromIdentity = identities?.find(i => same(i.address, address))?.name;
    if (fromIdentity) return formatActorName(fromIdentity);
    const found = config.actors.find(a => same(a.address, address));
    return found ? formatActorName(found.name) : short(address);
  }

  function vaultCard(v: Vault, index: number) {
    const Icon = v.category === 'Family memories' ? Heart : v.category === 'Account access' ? KeyRound : FileText;
    const isPending = v.state.status === 1;

    return (
      <button
        className={`vault-card ${isPending ? 'border-amber' : ''}`}
        key={v.state.id}
        onClick={() => onSelectVault(v.state.id)}
      >
        <div className="card-top">
          <span className={`asset-icon color-${index % 3}`}>
            <Icon size={22} />
          </span>
          <span className={`status-badge status-${v.state.status}`}>
            <span />
            {statusLabel(v)}
          </span>
        </div>
        <h3>{v.label}</h3>
        <p>{v.category}</p>

        <div className="card-policy">
          <span>
            <UsersRound size={14} /> 2 of 3 guardians
          </span>
          <span>
            <LockKeyhole size={13} /> AES-256
          </span>
          <span>{backupRecipient(v.state) ? 'Optional backup' : 'Primary only'}</span>
        </div>

        <div className="card-bottom">
          <span className="beneficiary-avatar">{nameOf(v.state.beneficiary).slice(0, 1)}</span>
          <span>
            {v.state.status === 0 ? 'Primary: ' : 'Selected: '}<strong>{nameOf(v.state.status === 0 ? v.state.beneficiary : selectedRecipient(v.state))}</strong>
          </span>
          <ArrowUpRight size={17} />
        </div>

        {isPending && (
          <div className="card-pending-strip">
            <AlertTriangle size={13} />
            <span>{v.state.quorumAt ? 'Quorum reached' : 'Awaiting quorum'} · Check in to cancel</span>
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar tailored for Vault Owner */}
      <aside className="sidebar">
        <div onClick={() => navigate('/owner')} style={{ cursor: 'pointer' }}>
          <Brand />
        </div>

        <div className="workspace">
          <span className="workspace-icon owner-theme">
            <ShieldCheck size={18} />
          </span>
          <div>
            Vault Owner<small>Personal Legacy Workspace</small>
          </div>
        </div>

        <span className="nav-caption">OWNER WORKSPACE</span>
        <nav>
          <button
            type="button"
            className={activeTab === 'vaults' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/owner')}
          >
            <FolderLock size={19} />
            My Vaults
            <span className="nav-total">{ownedVaults.length}</span>
          </button>

          <button
            type="button"
            className={activeTab === 'checkins' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/owner/checkins')}
          >
            <Fingerprint size={19} />
            Check-In Manager
            {activeChallenges.length > 0 && (
              <span className="nav-count amber">{activeChallenges.length}</span>
            )}
          </button>

          <button
            type="button"
            className={activeTab === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/owner/activity')}
          >
            <Activity size={19} />
            Activity Log
          </button>
        </nav>

        {/* Cross-Role "Assigned to me" Section */}
        {(beneficiaryVaults.length > 0 || guardianVaults.length > 0) && (
          <div className="sidebar-cross-role-box">
            <span className="nav-caption">ASSIGNED TO ME</span>
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
            {guardianVaults.length > 0 && (
              <button
                type="button"
                className="cross-role-link-btn"
                onClick={() => navigate('/guardian')}
              >
                <KeyRound size={15} />
                <span>Guardian for {guardianVaults.length} vault(s)</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-note">
          <span className="note-spark">✳</span>
          <h4>Keep your legacy secure.</h4>
          <p>
            Regular check-ins keep your recovery clock reset and prevent premature claims.
          </p>
          <button type="button" onClick={onOpenHelp}>
            How Heirloom works <ArrowUpRight size={14} />
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
            <small>
              Owner · {short(currentUser.address)}
            </small>
          </div>
        </div>
      </aside>

      {/* Main Shell */}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Vault Owner</span>
            <ChevronRight size={13} />
            <strong>
              {activeTab === 'checkins'
                ? 'Check-In Manager'
                : activeTab === 'activity'
                ? 'Activity Log'
                : 'My Vaults'}
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
          {/* Prominent Recovery Challenge Alert */}
          {activeChallenges.length > 0 && (
            <div className="critical-recovery-alert" role="alert">
              <div className="alert-content-left">
                <AlertTriangle size={24} className="alert-icon-bounce" />
                <div>
                  <strong>
                    RECOVERY CLAIM ACTIVE: {activeChallenges.length} vault(s) awaiting your response
                  </strong>
                  <p>
                    A beneficiary opened a recovery request. Two guardian approvals start the full
                    cancellation window. Check in before finalization to cancel the request and reset eligibility.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="button primary alert-action-btn"
                disabled={!!busy || offline}
                onClick={() => checkIn(activeChallenges[0])}
              >
                <Fingerprint size={16} />
                I’m Here — Cancel Recovery
              </button>
            </div>
          )}

          {/* Heading */}
          <div className="page-heading">
            <div>
              <span className="eyebrow">VAULT OWNER WORKSPACE</span>
              <h1>
                {activeTab === 'checkins'
                  ? 'Check-in deadlines & status'
                  : activeTab === 'activity'
                  ? 'Vault timeline & on-chain receipts'
                  : 'Your encrypted vaults'}
              </h1>
              <p>
                {activeTab === 'checkins'
                  ? 'Sign a check-in transaction to reset both eligibility clocks and cancel any pending recovery.'
                  : activeTab === 'activity'
                  ? 'Audit transactions, guardian approvals, and check-in events written directly to Ethereum.'
                  : 'Assets encrypted with your client-side AES-256 keys and protected by guardian quorum.'}
              </p>
            </div>

            <div className="page-heading-actions">
              <button
                type="button"
                className="button primary"
                onClick={onCreateVault}
                disabled={!!busy}
              >
                <Plus size={17} />
                Create a vault
              </button>
            </div>
          </div>

          {/* Stats Bar */}
          <section className="stats-grid">
            <div className="stat-card">
              <span className="stat-icon lilac">
                <FolderLock size={20} />
              </span>
              <div>
                <span>Owned vaults</span>
                <strong>
                  {ownedVaults.length.toString().padStart(2, '0')}
                  <small>encrypted assets</small>
                </strong>
              </div>
            </div>

            <div className="stat-card">
              <span className="stat-icon sage">
                <Fingerprint size={20} />
              </span>
              <div>
                <span>Next check-in deadline</span>
                <strong>
                  {nextDeadlineSeconds !== null ? duration(nextDeadlineSeconds) : 'No vaults'}
                  <small>
                    {nextDeadlineSeconds !== null ? 'until eligible for claim' : 'create a vault'}
                  </small>
                </strong>
              </div>
              <span className={`stat-dot ${nextDeadlineSeconds && nextDeadlineSeconds < 86400 ? 'amber' : ''}`} />
            </div>

            <div className="stat-card">
              <span className="stat-icon peach">
                <Clock3 size={20} />
              </span>
              <div>
                <span>Pending recovery challenges</span>
                <strong>
                  {activeChallenges.length.toString().padStart(2, '0')}
                  <small>{activeChallenges.length ? 'requires attention' : 'all is calm'}</small>
                </strong>
              </div>
              <span className={`stat-dot ${activeChallenges.length ? 'amber' : ''}`} />
            </div>
          </section>

          {activeTab !== 'activity' && ownedVaults.length > 0 && <div className="owner-succession-panel">
            {ownedVaults.length > 1 && <label className="succession-vault-picker">View succession policy<select value={graphVaultId} onChange={e => setGraphVaultId(e.target.value)}><option value="">All assets</option>{ownedVaults.map(v => <option key={v.state.id} value={v.state.id}>{v.label}</option>)}</select></label>}
            <div className="owner-succession-graphs">{graphVaults.map(vault => <SuccessionGraph key={vault.state.id} vault={vault} time={time} block={block} offline={offline} nameOf={nameOf}/>)}</div>
          </div>}

          {/* Main Subview: Vaults */}
          {activeTab === 'vaults' && (
            <>
              <div className="asset-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    placeholder="Search your owned vaults…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filter vault status"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  {['All vaults', 'Protected', 'Recovery pending', 'Released'].map(f => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                {onImportKit && (
                  <button
                    type="button"
                    className="button secondary small-button"
                    onClick={onImportKit}
                  >
                    <Upload size={15} />
                    Import kit
                  </button>
                )}
              </div>

              {visibleVaults.length > 0 ? (
                <div className="vault-grid">{visibleVaults.map(vaultCard)}</div>
              ) : (
                <div className="empty-vault">
                  <span className="empty-art">
                    <FolderLock size={30} />
                  </span>
                  <div>
                    <h3>No owned vaults found.</h3>
                    <p>
                      {search
                        ? 'No vaults match your search filter.'
                        : 'Create your first encrypted vault to pass on vital documents, or load sample vaults.'}
                    </p>
                  </div>
                  {config.mode === 'local' && !search && onLoadSamples && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!!busy}
                      onClick={onLoadSamples}
                    >
                      <Play size={15} />
                      {busy || 'Load sample vaults'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Subview: Check-in Manager */}
          {activeTab === 'checkins' && (
            <div className="checkin-manager-panel">
              <div className="section-heading">
                <h2>Check-in Deadlines by Vault</h2>
              </div>

              {ownedVaults.length > 0 ? (
                <div className="checkin-table-container">
                  <table className="checkin-table">
                    <thead>
                      <tr>
                        <th>Vault Name</th>
                        <th>Status</th>
                        <th>Inactivity Interval</th>
                        <th>Next Deadline</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownedVaults.map(v => {
                        const elapsed = time >= v.state.lastCheckIn + v.state.inactivity;
                        const remaining = Math.max(0, v.state.lastCheckIn + v.state.inactivity - time);
                        const isChallenge = v.state.status === 1;

                        return (
                          <tr key={v.state.id} className={isChallenge ? 'row-alert' : ''}>
                            <td>
                              <strong>{v.label}</strong>
                              <small>{short(v.state.id)}</small>
                            </td>
                            <td>
                              <span className={`status-badge status-${v.state.status}`}>
                                {statusLabel(v)}
                              </span>
                            </td>
                            <td>{duration(v.state.inactivity)}</td>
                            <td>
                              {isChallenge ? (
                                <span className="text-warning">
                                  {v.state.quorumAt ? `Cancellation deadline: ${policyDate(v.state.quorumAt + v.state.challenge)}` : 'Awaiting second guardian approval'}
                                </span>
                              ) : elapsed ? (
                                <span className="text-danger">Inactivity period elapsed</span>
                              ) : (
                                <span>{duration(remaining)} remaining</span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button secondary small-button"
                                disabled={!!busy || offline || v.state.status === 2}
                                onClick={() => checkIn(v)}
                              >
                                <Fingerprint size={14} />
                                {isChallenge ? 'Cancel recovery' : 'Check in now'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="large-empty">
                  <Fingerprint size={32} />
                  <h3>No vaults to check in on.</h3>
                  <p>Create a vault first to configure your check-in interval.</p>
                </div>
              )}
            </div>
          )}

          {/* Subview: Activity Log */}
          {activeTab === 'activity' && (
            <div className="all-activity">
              <div className="section-heading">
                <h2>Vault Owner History <span>{ownedEvents.length}</span></h2>
              </div>
              {ownedEvents.length ? (
                ownedEvents.map((e, i) => (
                  <button
                    type="button"
                    className="activity-row"
                    key={`${e.hash}-${e.name}-${i}`}
                    onClick={() => onInspectTx(e.hash)}
                  >
                    <span className="event-icon">
                      <FolderLock size={17} />
                    </span>
                    <span className="event-copy">
                      <strong>{e.name}</strong>
                      <small>
                        {ownedVaults.find(v => v.state.id === e.vaultId)?.label ?? short(e.vaultId)}
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
                  <h3>No transactions recorded yet.</h3>
                  <p>When you create a vault or check in, on-chain events will appear here.</p>
                </div>
              )}
            </div>
          )}

          <footer className="page-footer">
            <span>
              <Sprout size={14} />
              Heirloom Protocol · Vault Owner Space
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
