import { ArrowRight, FileLock2, Gift, ShieldCheck } from 'lucide-react';
import type { Vault } from '../lib/types';
import { backupRecipient, canRequest, policyDate, selectedRecipient } from '../lib/workspace-policy';

interface GraphProps {
  vault: Vault;
  time: number;
  block: number;
  offline: boolean;
  nameOf: (address: string) => string;
}

export function RecoveryPolicyStatus({ vault, time, block, offline, nameOf }: GraphProps) {
  const s = vault.state;
  const backup = backupRecipient(s);
  const deadline = s.quorumAt > 0 ? s.quorumAt + s.challenge : undefined;
  return <div className="recovery-policy-status">
    <p><strong>{s.policyVersion === 2 ? 'Succession policy · v2' : 'Primary-only policy · v1'}</strong>
      {backup ? ` · Backup: ${nameOf(backup)}` : ' · No backup configured'}</p>
    {s.status !== 0 && <p>Request #{s.requestId} · Selected recipient: <strong>{nameOf(selectedRecipient(s))}</strong>. {s.status === 1 ? 'This recipient cannot be displaced while recovery is pending.' : 'Only this recipient can recover the asset.'}</p>}
    {s.status === 1 && <p>Confirmed quorum: {s.approvalCount} / 2 approvals. {deadline
      ? `Owner cancellation window ${!offline && time >= deadline ? 'elapsed at' : 'ends at'} ${policyDate(deadline)}.`
      : 'The full owner cancellation window starts with the second guardian approval.'}</p>}
    <small>{offline ? 'Chain connection unavailable. Refresh before taking action.' : `As of confirmed block #${block} · ${policyDate(time)}`}</small>
  </div>;
}

export default function SuccessionGraph(props: GraphProps) {
  const { vault, time, offline, nameOf } = props;
  const s = vault.state;
  const backup = backupRecipient(s);
  const primaryAt = s.lastCheckIn + s.inactivity;
  const backupAt = primaryAt + (s.backupWaitingDuration ?? 0);
  function recipientStatus(address: string, deadline: number) {
    if (s.status !== 0) {
      if (address.toLowerCase() === selectedRecipient(s).toLowerCase()) {
        return s.status === 2 ? 'Finalized recipient' : `Selected for request #${s.requestId}`;
      }
      return s.status === 1 ? 'Blocked by the pending request' : 'Not selected for release';
    }
    if (offline || time <= 0) return 'Refresh chain state to check eligibility';
    return canRequest(s, address, time) ? 'Eligible to request now' : `Waiting until ${policyDate(deadline)}`;
  }
  return <section className="succession-graph" aria-label={`Succession graph for ${vault.label}`}>
    <div className="succession-graph-heading"><ShieldCheck size={17}/><h3>Succession Graph</h3></div>
    <ol className={`succession-path ${backup ? 'has-backup' : ''}`}>
      <li className="succession-node succession-asset"><FileLock2 size={21}/><span>Encrypted asset</span><strong>{vault.label}</strong><small>{s.status === 2 ? 'Recovery finalized' : s.status === 1 ? 'Recovery pending' : 'Protected'}</small></li>
      <li className="succession-edge"><ArrowRight size={21} aria-hidden="true"/><span>After inactivity</span></li>
      <li className="succession-node"><Gift size={21}/><span>Primary beneficiary</span><strong>{nameOf(s.beneficiary)}</strong><small>{recipientStatus(s.beneficiary, primaryAt)}</small><time dateTime={new Date(primaryAt * 1000).toISOString()}>Eligible from {policyDate(primaryAt)}</time></li>
      {backup && <><li className="succession-edge"><ArrowRight size={21} aria-hidden="true"/><span>Additional backup wait</span></li>
        <li className="succession-node succession-backup"><Gift size={21}/><span>Optional backup</span><strong>{nameOf(backup)}</strong><small>{recipientStatus(backup, backupAt)}</small><time dateTime={new Date(backupAt * 1000).toISOString()}>Eligible from {policyDate(backupAt)}</time></li></>}
    </ol>
    <RecoveryPolicyStatus {...props}/>
    <p className="succession-safeguard">Two of three guardians independently verify circumstances off-chain. Their quorum starts the full owner cancellation window. The primary remains eligible after the backup wait.</p>
  </section>;
}
