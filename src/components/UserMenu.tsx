import React, { useState, useRef, useEffect } from 'react';
import {
  LogOut,
  ChevronDown,
  Copy,
  Check,
  ShieldCheck,
  Gift,
  KeyRound,
  LogIn,
  UserPlus,
} from 'lucide-react';
import { useRouter, Link } from '../lib/router';
import type { UserAccount } from '../lib/auth';

interface UserMenuProps {
  currentUser: UserAccount | null;
  onLogout: () => void;
}

const shortAddress = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function UserMenu({
  currentUser,
  onLogout,
}: UserMenuProps) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleCopyAddress() {
    if (!currentUser?.address) return;
    navigator.clipboard.writeText(currentUser.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!currentUser) {
    return (
      <div className="auth-buttons-group">
        <Link
          href="/login"
          className="button secondary small-button auth-nav-btn"
        >
          <LogIn size={14} />
          Sign In
        </Link>
        <Link
          href="/signup"
          className="button primary small-button auth-nav-btn"
        >
          <UserPlus size={14} />
          Sign Up
        </Link>
      </div>
    );
  }

  const roleIcon =
    currentUser.role === 'owner' ? (
      <ShieldCheck size={13} />
    ) : currentUser.role === 'beneficiary' ? (
      <Gift size={13} />
    ) : (
      <KeyRound size={13} />
    );

  const roleLabel =
    currentUser.role === 'owner'
      ? 'Vault Owner'
      : currentUser.role === 'beneficiary'
      ? 'Beneficiary'
      : 'Trusted Guardian';

  return (
    <div className="user-menu-wrapper" ref={menuRef}>
      <button
        type="button"
        className={`user-profile-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User account menu"
      >
        <span className="avatar small user-trigger-avatar">{currentUser.initials}</span>
        <div className="user-trigger-info">
          <span className="user-trigger-name">{currentUser.name}</span>
          <span className={`user-role-badge ${currentUser.role}`}>
            {roleIcon}
            {roleLabel}
          </span>
        </div>
        <ChevronDown size={14} className={`user-trigger-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="user-dropdown-popover" role="menu">
          <div className="dropdown-user-header">
            <span className="avatar dropdown-avatar">{currentUser.initials}</span>
            <div className="dropdown-user-meta">
              <strong>{currentUser.name}</strong>
              <small>{currentUser.email}</small>
              <span className={`user-role-badge ${currentUser.role}`}>
                {roleIcon}
                {roleLabel.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="dropdown-address-card">
            <span className="dropdown-address-label">Connected Wallet Address</span>
            <div className="dropdown-address-row">
              <code>{shortAddress(currentUser.address)}</code>
              <button
                type="button"
                className="copy-address-btn"
                onClick={handleCopyAddress}
                title="Copy address"
              >
                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="dropdown-divider" />

          <button
            type="button"
            className="dropdown-menu-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
