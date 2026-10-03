import React, { useState } from 'react';
import {
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ArrowRight,
  LoaderCircle,
  AlertCircle,
  ShieldCheck,
  Gift,
  KeyRound,
  UserCheck,
  CheckCircle2,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { Link, useRouter } from '../lib/router';
import { loginWithEmail, loginDemoActor, getDefaultDemoUsers, type UserAccount } from '../lib/auth';
import type { Config } from '../lib/types';

interface LogInPageProps {
  config?: Config;
  onSuccess: (user: UserAccount) => void;
}

export default function LogInPage({ config, onSuccess }: LogInPageProps) {
  const { navigate, query } = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isLocal = config?.mode === 'local';
  const demoActors = config ? getDefaultDemoUsers(config.actors) : [];

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      errors.email = 'Please enter your email address';
    } else if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      errors.email = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Please enter your password';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!validate()) return;

    try {
      if (!config) throw new Error('Chain configuration is still loading. Please wait a moment.');
      setBusy(config.mode === 'public' ? 'Confirming your wallet and session...' : 'Authenticating session...');
      const user = await loginWithEmail(email, password, config);
      onSuccess(user);
      const roleHome =
        user.role === 'guardian'
          ? '/guardian'
          : user.role === 'beneficiary'
          ? '/beneficiary'
          : '/owner';
      const destination = query.redirect && query.redirect !== '/app' ? query.redirect : roleHome;
      navigate(destination);
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please check your email and password.');
    } finally {
      setBusy('');
    }
  }

  async function handleDemoActorLogin(demo: UserAccount) {
    if (busy) return;
    setError('');
    try {
      setBusy(`Signing in as ${demo.name}...`);
      const user = await loginDemoActor(demo.address);
      onSuccess(user);
      const roleHome =
        user.role === 'guardian'
          ? '/guardian'
          : user.role === 'beneficiary'
          ? '/beneficiary'
          : '/owner';
      const destination = query.redirect && query.redirect !== '/app' ? query.redirect : roleHome;
      navigate(destination);
    } catch (err: any) {
      setError(err?.message || 'Failed to authenticate demo account.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="auth-page-shell">
      {/* Top Bar with Brand and Back Link */}
      <header className="auth-page-topbar">
        <div className="auth-topbar-inner">
          <div onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <Brand />
          </div>
          <Link href="/" className="auth-back-home-link">
            ← Back to Heirloom
          </Link>
        </div>
      </header>

      <main className="auth-page-main">
        <div className="auth-page-card">
          <div className="auth-page-header">
            <span className="auth-page-eyebrow">HEIRLOOM ACCESS</span>
            <h1>Welcome back</h1>
            <p>
              Sign in to manage your encrypted vaults, attestations, and inherited digital assets.
              {config?.mode === 'public' && ' Connect the wallet linked to your account when prompted.'}
            </p>
          </div>

          {query.redirect && (
            <div className="auth-redirect-notice">
              <span>Sign in to access your requested workspace page.</span>
            </div>
          )}

          {error && (
            <div className="auth-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleLogin} noValidate>
            <div className="auth-field">
              <label htmlFor="login-email">Email Address</label>
              <div className="auth-input-wrap">
                <Mail size={16} className="auth-field-icon" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' });
                  }}
                  disabled={!!busy}
                  required
                />
              </div>
              {fieldErrors.email && <span className="field-error-text">{fieldErrors.email}</span>}
            </div>

            <div className="auth-field">
              <label htmlFor="login-password">Password</label>
              <div className="auth-input-wrap">
                <LockKeyhole size={16} className="auth-field-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your account password"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                  }}
                  disabled={!!busy}
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErrors.password && (
                <span className="field-error-text">{fieldErrors.password}</span>
              )}
            </div>

            <button
              type="submit"
              className="button primary full auth-submit-btn"
              disabled={!!busy}
            >
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  {busy}
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {/* Local Evaluation Demo Accounts */}
            {isLocal && demoActors.length > 0 && (
              <>
                <div className="auth-divider">
                  <span>OR INSTANT LOCAL DEMO LOGIN</span>
                </div>

                <div className="demo-login-explainer">
                  <small>
                    {demoActors.length} pre-funded local Hardhat accounts with real on-chain transaction permissions:
                  </small>
                </div>

                <div className="demo-accounts-grid">
                  {demoActors.map(demo => (
                    <button
                      key={demo.id}
                      type="button"
                      className="demo-account-chip"
                      disabled={!!busy}
                      onClick={() => handleDemoActorLogin(demo)}
                      title={`Sign in as ${demo.name} (${demo.role})`}
                    >
                      <span className="demo-chip-avatar">{demo.initials}</span>
                      <div className="demo-chip-info">
                        <strong>{demo.name}</strong>
                        <small>{demo.email}</small>
                      </div>
                      <span className={`demo-role-tag ${demo.role}`}>{demo.role}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="auth-footer-prompt">
              <p>
                Don't have an account yet?{' '}
                <Link
                  href={query.redirect ? `/signup?redirect=${encodeURIComponent(query.redirect)}` : '/signup'}
                  className="auth-link-btn"
                >
                  Create one now
                </Link>
              </p>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
