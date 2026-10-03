import React, { useState } from 'react';
import {
  Gift,
  ShieldCheck,
  LockKeyhole,
  Clock3,
  KeyRound,
  ArrowRight,
  ArrowUpRight,
  Search,
  Heart,
  FileText,
  Activity,
  Sprout,
  ChevronRight,
  CircleHelp,
  FolderLock,
  Download,
  AlertCircle,
  CheckCircle,
  FileDown,
  Info,
  UsersRound,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import UserMenu from '../components/UserMenu';
import { useRouter } from '../lib/router';
import type { Config, Actor, Vault, TimelineEvent, AssetData, IdentityRecord } from '../lib/types';
import { formatActorName, type UserAccount } from '../lib/auth';

interface BeneficiaryWorkspaceProps {
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
  decrypted?: { id: string; asset: AssetData };
  onRefresh: () => Promise<void>;
  onSelectVault: (vaultId: string) => void;
  onRequestRecovery: (vault: Vault) => Promise<void>;
  onFinalizeRecovery: (vault: Vault) => Promise<void>;
  onDecryptVault: (vault: Vault) => Promise<void>;
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

export default function BeneficiaryWorkspace({
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
  decrypted,
  onRefresh,
  onSelectVault,
  onRequestRecovery,
  onFinalizeRecovery,
  onDecryptVault,
  onInspectTx,
  onOpenHelp,
  onLogout,
}: BeneficiaryWorkspaceProps) {
  const { path, navigate } = useRouter();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  // Filter vaults where connected wallet is the designated beneficiary
  const beneficiaryVaults = vaults.filter(v => same(v.state.beneficiary, currentUser.address));
  const ownedVaults = vaults.filter(v => same(v.state.owner, currentUser.address));
  const guardianVaults = vaults.filter(v => v.state.guardians.some(g => same(g, currentUser.address)));

  // Subpage tabs
  const activeTab: 'vaults' | 'claims' | 'activity' = path.includes('/claims')
    ? 'claims'
    : path.includes('/activity')
    ? 'activity'
    : 'vaults';

  // Counts
  const eligibleToRequest = beneficiaryVaults.filter(
    v => v.state.status === 0 && time >= v.state.lastCheckIn + v.state.inactivity
  );
  const inRecovery = beneficiaryVaults.filter(v => v.state.status === 1);
  const readyToFinalize = inRecovery.filter(
    v =>
      v.state.approvalCount >= 2 &&
      v.state.quorumAt &&
      time >= v.state.quorumAt + v.state.challenge
  );
  const finalizedCount = beneficiaryVaults.filter(v => v.state.status === 2);

  const visibleVaults = beneficiaryVaults.filter(
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

  function downloadAsset(asset: AssetData) {
    const blob = new Blob([asset.bytes], { type: asset.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getBeneficiaryStatusCopy(v: Vault): { label: string; detail: string; badgeClass: string } {
    if (v.state.status === 2) {
      return {
        label: 'Ready to Decrypt',
        detail: 'Recovery finalized on Ethereum. Download your inherited asset.',
        badgeClass: 'status-2',
      };
    }

    if (v.state.status === 1) {
      const quorumMet = v.state.approvalCount >= 2;
      const challengeEnded = v.state.quorumAt && time >= v.state.quorumAt + v.state.challenge;

      if (challengeEnded) {
        return {
          label: 'Ready to Finalize',
          detail: 'Guardian quorum confirmed and challenge window ended. Ready for on-chain finalization.',
          badgeClass: 'status-1',
        };
      }

      if (quorumMet) {
        const remaining = Math.max(0, (v.state.quorumAt ?? 0) + v.state.challenge - time);
        return {
          label: 'Challenge Window Active',
          detail: `2 guardians approved. Owner challenge window running (${duration(remaining)} remaining).`,
          badgeClass: 'status-1',
        };
      }

      return {
        label: 'Awaiting Guardians',
        detail: `Recovery opened. ${v.state.approvalCount} of 2 required guardian approvals confirmed.`,
        badgeClass: 'status-1',
      };
    }

    // Status 0: Protected
    const inactivityElapsed = time >= v.state.lastCheckIn + v.state.inactivity;
    if (inactivityElapsed) {
      return {
        label: 'Eligible for Recovery',
        detail: 'Owner inactivity period has elapsed. You can initiate a recovery request.',
        badgeClass: 'status-1',
      };
    }

    const untilEligible = v.state.lastCheckIn + v.state.inactivity - time;
    return {
      label: 'Protected (Owner Active)',
      detail: `Owner is actively checking in. Inactivity threshold elapses in ${duration(untilEligible)}.`,
      badgeClass: 'status-0',
    };
  }

  return (
    <div className="app-shell">
      {/* Sidebar for Beneficiary */}
      <aside className="sidebar">
        <div onClick={() => navigate('/beneficiary')} style={{ cursor: 'pointer' }}>
          <Brand />
        </div>

        <div className="workspace">
          <span className="workspace-icon beneficiary-theme">
            <Gift size={18} />
          </span>
          <div>
            Beneficiary<small>Designated Heir Workspace</small>
          </div>
        </div>

        <span className="nav-caption">BENEFICIARY WORKSPACE</span>
        <nav>
          <button
            type="button"
            className={activeTab === 'vaults' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/beneficiary')}
          >
            <Gift size={19} />
            Designated Vaults
            <span className="nav-total">{beneficiaryVaults.length}</span>
          </button>

          <button
            type="button"
            className={activeTab === 'claims' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/beneficiary/claims')}
          >
            <Clock3 size={19} />
            Active Claims
            {inRecovery.length > 0 && <span className="nav-count amber">{inRecovery.length}</span>}
          </button>

          <button
            type="button"
            className={activeTab === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/beneficiary/activity')}
          >
            <Activity size={19} />
            Activity Log
          </button>
        </nav>

        {/* Cross-Role "Assigned to me" Section */}
        {(ownedVaults.length > 0 || guardianVaults.length > 0) && (
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
          <h4>How recovery works.</h4>
          <p>
            When a vault owner becomes inactive, 2 independent guardians attest before you can claim.
          </p>
          <button type="button" onClick={onOpenHelp}>
            Protocol Safeguards <ArrowUpRight size={14} />
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
            <small>Beneficiary · {short(currentUser.address)}</small>
          </div>
        </div>
      </aside>

      {/* Main Shell */}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Beneficiary</span>
            <ChevronRight size={13} />
            <strong>
              {activeTab === 'claims'
                ? 'Active Claims'
                : activeTab === 'activity'
                ? 'Activity Log'
                : 'Designated Vaults'}
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
          {/* Decrypted Asset Banner if any is active */}
          {decrypted && (
            <div className="decrypted-quick-card">
              <div className="decrypted-quick-info">
                <CheckCircle size={22} className="text-success" />
                <div>
                  <strong>Successfully Decrypted: {decrypted.asset.name}</strong>
                  <p>
                    Reconstructed locally from verified guardian key shares. Plaintext bytes are available.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="button primary small-button"
                onClick={() => downloadAsset(decrypted.asset)}
              >
                <Download size={14} />
                Download Decrypted File
              </button>
            </div>
          )}

          {/* Heading */}
          <div className="page-heading">
            <div>
              <span className="eyebrow">BENEFICIARY WORKSPACE</span>
              <h1>
                {activeTab === 'claims'
                  ? 'Recovery claims & countdowns'
                  : activeTab === 'activity'
                  ? 'Beneficiary on-chain timeline'
                  : 'Vaults designated for you'}
              </h1>
              <p>
                {activeTab === 'claims'
                  ? 'Monitor guardian attestations and challenge windows for assets in recovery.'
                  : activeTab === 'activity'
                  ? 'Audit smart contract events for vaults where you are named as beneficiary.'
                  : 'Assets entrusted to your future custody. The Ethereum contract enforces all recovery rules.'}
              </p>
            </div>
          </div>

          {/* Stats Bar */}
          <section className="stats-grid">
            <div className="stat-card">
              <span className="stat-icon peach">
                <Gift size={20} />
              </span>
              <div>
                <span>Designated vaults</span>
                <strong>
                  {beneficiaryVaults.length.toString().padStart(2, '0')}
                  <small>entrusted to you</small>
                </strong>
              </div>
            </div>

            <div className="stat-card">
              <span className="stat-icon lilac">
                <Clock3 size={20} />
              </span>
              <div>
                <span>Claims in recovery</span>
                <strong>
                  {inRecovery.length.toString().padStart(2, '0')}
                  <small>{inRecovery.length ? 'attestation active' : 'no open claims'}</small>
                </strong>
              </div>
              <span className={`stat-dot ${inRecovery.length ? 'amber' : ''}`} />
            </div>

            <div className="stat-card">
              <span className="stat-icon sage">
                <KeyRound size={20} />
              </span>
              <div>
                <span>Ready to decrypt</span>
                <strong>
                  {finalizedCount.length.toString().padStart(2, '0')}
                  <small>finalized on-chain</small>
                </strong>
              </div>
              <span className={`stat-dot ${finalizedCount.length ? 'green' : ''}`} />
            </div>
          </section>

          {/* Subview: Vaults */}
          {activeTab === 'vaults' && (
            <>
              <div className="asset-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    placeholder="Search designated vaults…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {visibleVaults.length > 0 ? (
                <div className="beneficiary-vault-list">
                  {visibleVaults.map(v => {
                    const statusInfo = getBeneficiaryStatusCopy(v);
                    const isEligibleRequest =
                      v.state.status === 0 && time >= v.state.lastCheckIn + v.state.inactivity;
                    const isReadyFinalize =
                      v.state.status === 1 &&
                      v.state.approvalCount >= 2 &&
                      v.state.quorumAt &&
                      time >= v.state.quorumAt + v.state.challenge;
                    const isReadyDecrypt = v.state.status === 2;

                    return (
                      <div className="beneficiary-vault-row" key={v.state.id}>
                        <div className="beneficiary-row-main">
                          <div className="beneficiary-row-header">
                            <span className="asset-icon color-1">
                              <Heart size={20} />
                            </span>
                            <div>
                              <h3>{v.label}</h3>
                              <p>
                                Created by <strong>{nameOf(v.state.owner)}</strong> ({short(v.state.owner)})
                              </p>
                            </div>
                            <span className={`status-badge ${statusInfo.badgeClass}`}>
                              {statusInfo.label}
                            </span>
                          </div>

                          <div className="beneficiary-row-details">
                            <div className="meta-pill">
                              <UsersRound size={13} />
                              <span>2 of 3 guardian attestations required</span>
                            </div>
                            <div className="meta-pill">
                              <Clock3 size={13} />
                              <span>Inactivity threshold: {duration(v.state.inactivity)}</span>
                            </div>
                            <div className="meta-pill">
                              <LockKeyhole size={13} />
                              <span>Challenge period: {duration(v.state.challenge)}</span>
                            </div>
                          </div>

                          <div className="beneficiary-status-explanation">
                            <Info size={14} />
                            <span>{statusInfo.detail}</span>
                          </div>
                        </div>

                        <div className="beneficiary-row-actions">
                          {isEligibleRequest && (
                            <button
                              type="button"
                              className="button primary"
                              disabled={!!busy}
                              onClick={() => onRequestRecovery(v)}
                            >
                              <ShieldCheck size={16} />
                              Request Recovery
                            </button>
                          )}

                          {isReadyFinalize && (
                            <button
                              type="button"
                              className="button primary"
                              disabled={!!busy}
                              onClick={() => onFinalizeRecovery(v)}
                            >
                              <KeyRound size={16} />
                              Finalize Recovery
                            </button>
                          )}

                          {isReadyDecrypt && (
                            <button
                              type="button"
                              className="button primary"
                              disabled={!!busy}
                              onClick={() => onDecryptVault(v)}
                            >
                              <LockKeyhole size={16} />
                              Decrypt Inherited Asset
                            </button>
                          )}

                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => onSelectVault(v.state.id)}
                          >
                            Inspect Policy
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-vault">
                  <span className="empty-art">
                    <Gift size={30} />
                  </span>
                  <div>
                    <h3>No designated vaults found.</h3>
                    <p>
                      {search
                        ? 'No vaults match your search filter.'
                        : `No vaults currently designate ${short(currentUser.address)} as beneficiary. When an owner names you as their beneficiary, their vault will appear here.`}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Subview: Active Claims */}
          {activeTab === 'claims' && (
            <div className="claims-panel">
              <div className="section-heading">
                <h2>Active Claims in Recovery</h2>
              </div>

              {inRecovery.length > 0 ? (
                <div className="claims-grid">
                  {inRecovery.map(v => {
                    const statusInfo = getBeneficiaryStatusCopy(v);
                    const canFinalize =
                      v.state.approvalCount >= 2 &&
                      v.state.quorumAt &&
                      time >= v.state.quorumAt + v.state.challenge;

                    return (
                      <div className="claim-card" key={v.state.id}>
                        <div className="claim-card-top">
                          <strong>{v.label}</strong>
                          <span className={`status-badge ${statusInfo.badgeClass}`}>
                            {statusInfo.label}
                          </span>
                        </div>
                        <p>{statusInfo.detail}</p>

                        <div className="claim-progress-bar">
                          <div
                            className="claim-progress-fill"
                            style={{
                              width: `${Math.min(100, (v.state.approvalCount / 2) * 50 + (v.state.quorumAt ? 50 : 0))}%`,
                            }}
                          />
                        </div>

                        <div className="claim-card-meta">
                          <span>Request #{v.state.requestId}</span>
                          <span>Approvals: {v.state.approvalCount} / 2</span>
                        </div>

                        {canFinalize ? (
                          <button
                            type="button"
                            className="button primary full"
                            disabled={!!busy}
                            onClick={() => onFinalizeRecovery(v)}
                          >
                            <KeyRound size={15} />
                            Finalize Recovery on Ethereum
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button secondary full"
                            onClick={() => onSelectVault(v.state.id)}
                          >
                            View Quorum Details
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="large-empty">
                  <Clock3 size={32} />
                  <h3>No claims currently in recovery.</h3>
                  <p>When an owner inactivity period elapses, you can open a recovery claim.</p>
                </div>
              )}
            </div>
          )}

          {/* Subview: Activity */}
          {activeTab === 'activity' && (
            <div className="all-activity">
              <div className="section-heading">
                <h2>Beneficiary Timeline</h2>
              </div>
              {events.filter(e => beneficiaryVaults.some(v => v.state.id === e.vaultId)).length ? (
                events
                  .filter(e => beneficiaryVaults.some(v => v.state.id === e.vaultId))
                  .map((e, i) => (
                    <button
                      type="button"
                      className="activity-row"
                      key={`${e.hash}-${e.name}-${i}`}
                      onClick={() => onInspectTx(e.hash)}
                    >
                      <span className="event-icon">
                        <Gift size={17} />
                      </span>
                      <span className="event-copy">
                        <strong>{e.name}</strong>
                        <small>
                          {beneficiaryVaults.find(v => v.state.id === e.vaultId)?.label ?? short(e.vaultId)}
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
                  <h3>No activity recorded yet for your beneficiary vaults.</h3>
                </div>
              )}
            </div>
          )}

          <footer className="page-footer">
            <span>
              <Sprout size={14} />
              Heirloom Protocol · Beneficiary Space
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
