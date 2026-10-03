import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ShieldCheck,
  Gift,
  KeyRound,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Info,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { Link, useRouter } from '../lib/router';
import { api } from '../lib/api';
import { registerUser, type UserRole, type UserAccount } from '../lib/auth';
import type { Config } from '../lib/types';

interface SignUpPageProps {
  config?: Config;
  onSuccess: (user: UserAccount) => void;
}

export default function SignUpPage({ config, onSuccess }: SignUpPageProps) {
  const { navigate, query } = useRouter();

  const [step, setStep] = useState<'details' | 'otp'>('details');

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<UserRole>('owner');

  // OTP Fields
  const [otpCode, setOtpCode] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpNotice, setOtpNotice] = useState('');

  // UI States
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Countdown timer for resend OTP cooldown
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  function validateDetails(): boolean {
    const errors: Record<string, string> = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) {
      errors.name = 'Please enter your full name';
    }
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      errors.email = 'Please enter a valid email address';
    }
    if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters long';
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!validateDetails()) {
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      setBusy('Sending verification code to your email...');
      const res = await api.sendOtp(cleanEmail);
      if (res.devNotice) {
        setOtpNotice(res.devNotice);
      } else {
        setOtpNotice(res.message || 'Verification code sent to your email.');
      }
      setStep('otp');
      setOtpCooldown(45);
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code. Please check your email.');
    } finally {
      setBusy('');
    }
  }

  async function handleResendOtp() {
    if (busy || otpCooldown > 0) return;
    setError('');
    try {
      setBusy('Sending new verification code...');
      const res = await api.sendOtp(email.trim().toLowerCase());
      if (res.devNotice) {
        setOtpNotice(res.devNotice);
      } else {
        setOtpNotice(res.message || 'A new verification code was sent to your email.');
      }
      setOtpCooldown(45);
    } catch (err: any) {
      setError(err?.message || 'Failed to resend code');
    } finally {
      setBusy('');
    }
  }

  async function handleVerifyAndRegister(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');

    const cleanCode = otpCode.trim();
    if (!cleanCode || cleanCode.length < 6) {
      setError('Please enter the complete 6-digit verification code');
      return;
    }

    if (!config) {
      setError('Chain configuration is still loading. Please wait a moment.');
      return;
    }

    try {
      setBusy('Verifying code & confirming email...');
      await api.verifyOtp(email.trim().toLowerCase(), cleanCode);

      setBusy(config.mode === 'public' ? 'Confirming wallet ownership and creating account...' : 'Generating cryptographic keys & initializing custody...');
      const user = await registerUser(
        {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
        },
        config
      );

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
      setError(err?.message || 'Registration failed. Please verify your code and try again.');
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
            <span className="auth-page-eyebrow">
              {step === 'otp' ? 'SECURITY VERIFICATION' : 'JOIN HEIRLOOM'}
            </span>
            <h1>{step === 'otp' ? 'Verify your email' : 'Create your account'}</h1>
            <p>
              {step === 'otp'
                ? `Enter the 6-digit security code sent to ${email}`
                : 'Begin protecting what matters. Your encrypted vaults and recovery rules start here.'}
            </p>
          </div>

          {error && (
            <div className="auth-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {step === 'otp' ? (
            <form className="auth-form" onSubmit={handleVerifyAndRegister}>
              <div className="otp-email-badge">
                <div className="otp-email-info">
                  <span className="otp-email-label">Verification Code Sent To:</span>
                  <strong>{email}</strong>
                </div>
                <button
                  type="button"
                  className="otp-change-email-btn"
                  disabled={!!busy}
                  onClick={() => {
                    setStep('details');
                    setError('');
                  }}
                >
                  Change
                </button>
              </div>

              {otpNotice && (
                <div className="otp-notice-box">
                  <Info size={16} className="otp-notice-icon" />
                  <span>{otpNotice}</span>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="signup-otp-input">6-Digit Security Code</label>
                <div className="auth-input-wrap">
                  <input
                    id="signup-otp-input"
                    className="otp-input-large"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="• • • • • •"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                    disabled={!!busy}
                    required
                  />
                </div>
              </div>

              <div className="otp-actions-row">
                <button
                  type="button"
                  className="otp-resend-btn"
                  disabled={!!busy || otpCooldown > 0}
                  onClick={handleResendOtp}
                >
                  <RefreshCw size={13} className={busy ? 'spin' : ''} />
                  {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend verification code'}
                </button>
              </div>

              <div className="auth-notice">
                <Sparkles size={16} className="auth-notice-icon" />
                <div>
                  <strong>Local Key Generation Follows Verification</strong>
                  <p>
                    Once verified, a dedicated RSA-OAEP encryption keypair will be created securely
                    inside your browser. No private keys are ever stored on our servers.
                    {config?.mode === 'public' && ' Your connected wallet will also ask you to sign a one-time account verification message.'}
                  </p>
                </div>
              </div>

              <button
                type="submit"
                className="button primary full auth-submit-btn"
                disabled={!!busy || otpCode.trim().length !== 6}
              >
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    {busy}
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    Verify & Create Account
                  </>
                )}
              </button>

              <button
                type="button"
                className="otp-back-btn"
                disabled={!!busy}
                onClick={() => {
                  setStep('details');
                  setError('');
                }}
              >
                <ArrowLeft size={14} />
                Back to Account Details
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleSendOtp} noValidate>
              <div className="auth-field">
                <label htmlFor="signup-name">Full Name</label>
                <div className="auth-input-wrap">
                  <User size={16} className="auth-field-icon" />
                  <input
                    id="signup-name"
                    type="text"
                    placeholder="e.g. Eleanor Vance"
                    value={name}
                    onChange={e => {
                      setName(e.target.value);
                      if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: '' });
                    }}
                    disabled={!!busy}
                    required
                  />
                </div>
                {fieldErrors.name && <span className="field-error-text">{fieldErrors.name}</span>}
              </div>

              <div className="auth-field">
                <label htmlFor="signup-email">Email Address</label>
                <div className="auth-input-wrap">
                  <Mail size={16} className="auth-field-icon" />
                  <input
                    id="signup-email"
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

              <div className="auth-field-row">
                <div className="auth-field">
                  <label htmlFor="signup-password">Password</label>
                  <div className="auth-input-wrap">
                    <LockKeyhole size={16} className="auth-field-icon" />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 6 characters"
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

                <div className="auth-field">
                  <label htmlFor="signup-confirm-password">Confirm Password</label>
                  <div className="auth-input-wrap">
                    <LockKeyhole size={16} className="auth-field-icon" />
                    <input
                      id="signup-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={e => {
                        setConfirmPassword(e.target.value);
                        if (fieldErrors.confirmPassword)
                          setFieldErrors({ ...fieldErrors, confirmPassword: '' });
                      }}
                      disabled={!!busy}
                      required
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && (
                    <span className="field-error-text">{fieldErrors.confirmPassword}</span>
                  )}
                </div>
              </div>

              {/* Three Role Cards */}
              <div className="auth-field">
                <label>Select Your Primary Role</label>
                <div className="role-selector-grid">
                  <button
                    type="button"
                    className={`role-card ${role === 'owner' ? 'selected' : ''}`}
                    onClick={() => setRole('owner')}
                  >
                    <div className="role-card-top">
                      <span className="role-icon-box owner-theme">
                        <ShieldCheck size={18} />
                      </span>
                      {role === 'owner' && <CheckCircle2 size={16} className="role-check" />}
                    </div>
                    <strong>Vault Owner</strong>
                    <p>Encrypt documents & memories with custom recovery policies.</p>
                  </button>

                  <button
                    type="button"
                    className={`role-card ${role === 'beneficiary' ? 'selected' : ''}`}
                    onClick={() => setRole('beneficiary')}
                  >
                    <div className="role-card-top">
                      <span className="role-icon-box beneficiary-theme">
                        <Gift size={18} />
                      </span>
                      {role === 'beneficiary' && <CheckCircle2 size={16} className="role-check" />}
                    </div>
                    <strong>Beneficiary</strong>
                    <p>Inherit, request authorization, and decrypt released vaults.</p>
                  </button>

                  <button
                    type="button"
                    className={`role-card ${role === 'guardian' ? 'selected' : ''}`}
                    onClick={() => setRole('guardian')}
                  >
                    <div className="role-card-top">
                      <span className="role-icon-box guardian-theme">
                        <KeyRound size={18} />
                      </span>
                      {role === 'guardian' && <CheckCircle2 size={16} className="role-check" />}
                    </div>
                    <strong>Trusted Guardian</strong>
                    <p>Hold 1-of-3 encrypted share and attest to recovery.</p>
                  </button>
                </div>
                <small className="role-disclaimer">
                  Role selection customizes your onboarding profile. Blockchain wallet addresses and
                  smart contracts enforce all cryptographic permissions.
                </small>
              </div>

              <div className="auth-notice">
                <Mail size={16} className="auth-notice-icon" />
                <div>
                  <strong>Email OTP verification</strong>
                  <p>
                    We’ll send a single-use 6-digit code to your email to verify ownership before generating
                    your custody keys.
                  </p>
                </div>
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
                    Send Verification Code
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <div className="auth-footer-prompt">
                <p>
                  Already have an account?{' '}
                  <Link
                    href={query.redirect ? `/login?redirect=${encodeURIComponent(query.redirect)}` : '/login'}
                    className="auth-link-btn"
                  >
                    Sign in here
                  </Link>
                </p>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
