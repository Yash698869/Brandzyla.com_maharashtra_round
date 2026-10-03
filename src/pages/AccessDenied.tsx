import React from 'react';
import {
  ShieldAlert,
  ArrowRight,
  LogOut,
  ArrowLeft,
  Home,
  ShieldCheck,
  Gift,
  KeyRound,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { useRouter } from '../lib/router';
import type { UserAccount, UserRole } from '../lib/auth';

interface AccessDeniedProps {
  requiredRole: UserRole;
  currentUser: UserAccount;
  onLogout: () => void;
}

const roleNames: Record<UserRole, string> = {
  owner: 'Vault Owner',
  beneficiary: 'Beneficiary',
  guardian: 'Trusted Guardian',
};

const shortAddress = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function AccessDenied({
  requiredRole,
  currentUser,
  onLogout,
}: AccessDeniedProps) {
  const { navigate } = useRouter();

  const userHomeRoute =
    currentUser.role === 'guardian'
      ? '/guardian'
      : currentUser.role === 'beneficiary'
      ? '/beneficiary'
      : '/owner';

  const RequiredIcon =
    requiredRole === 'owner'
      ? ShieldCheck
      : requiredRole === 'beneficiary'
      ? Gift
      : KeyRound;

  return (
    <div className="access-denied-shell">
      <header className="access-denied-header">
        <div className="access-denied-header-inner">
          <div onClick={() => navigate(userHomeRoute)} style={{ cursor: 'pointer' }}>
            <Brand />
          </div>
          <button
            type="button"
            className="button secondary small-button"
            onClick={onLogout}
          >
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      </header>

      <main className="access-denied-main">
        <div className="access-denied-card">
          <div className="access-denied-icon-wrap">
            <ShieldAlert size={36} />
          </div>

          <span className="access-denied-eyebrow">ACCESS RESTRICTED</span>
          <h1>{roleNames[requiredRole]} Workspace</h1>

          <p className="access-denied-message">
            You are signed in as <strong>{currentUser.name}</strong> with account role{' '}
            <span className={`actor-role-chip ${currentUser.role}`}>{roleNames[currentUser.role]}</span>.
            This workspace requires verified <strong>{roleNames[requiredRole]}</strong> authorization, and your
            connected wallet (<code>{shortAddress(currentUser.address)}</code>) has no active {requiredRole} assignments on-chain.
          </p>

          <div className="access-denied-auth-notice">
            <div className="access-denied-meta-item">
              <span>Signed In As:</span>
              <strong>{currentUser.email}</strong>
            </div>
            <div className="access-denied-meta-item">
              <span>Connected Wallet:</span>
              <code>{currentUser.address}</code>
            </div>
            <div className="access-denied-meta-item">
              <span>Required Capability:</span>
              <strong>{roleNames[requiredRole]}</strong>
            </div>
          </div>

          <div className="access-denied-actions">
            <button
              type="button"
              className="button primary full"
              onClick={() => navigate(userHomeRoute)}
            >
              Return to My Workspace ({roleNames[currentUser.role]})
              <ArrowRight size={16} />
            </button>

            <button
              type="button"
              className="button secondary full"
              onClick={() => navigate('/')}
            >
              <Home size={15} />
              Go to Public Home
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
