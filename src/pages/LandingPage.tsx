import React from 'react';
import {
  ShieldCheck,
  LockKeyhole,
  UsersRound,
  Clock3,
  KeyRound,
  ArrowRight,
  ArrowUpRight,
  Sprout,
  Heart,
  FileText,
  Sparkles,
  CheckCircle2,
  Fingerprint,
  Layers,
  FileCheck2,
  LogIn,
  UserPlus,
  Compass,
} from 'lucide-react';
import { Brand, VaultIllustration } from '../components/Brand';
import { Link, useRouter } from '../lib/router';
import type { UserAccount } from '../lib/auth';
import type { Config } from '../lib/types';

interface LandingPageProps {
  currentUser: UserAccount | null;
  config?: Config;
  onLogout: () => void;
}

export default function LandingPage({ currentUser, config, onLogout }: LandingPageProps) {
  const { navigate } = useRouter();

  return (
    <div className="landing-shell">
      {/* Top Navigation */}
      <header className="landing-header">
        <div className="landing-nav-container">
          <div className="landing-brand-wrap" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <Brand />
          </div>

          <nav className="landing-nav-links">
            <a href="#how-it-works" className="landing-nav-link">
              How it works
            </a>
            <a href="#security" className="landing-nav-link">
              Security
            </a>
            <a href="#faq" className="landing-nav-link">
              Safeguards
            </a>
          </nav>

          <div className="landing-nav-actions">
            {currentUser ? (
              <div className="landing-user-badge">
                <span className="landing-user-avatar">{currentUser.initials}</span>
                <span className="landing-user-name">{currentUser.name}</span>
                <button
                  type="button"
                  className="button secondary small-button"
                  onClick={() => {
                    const roleHome =
                      currentUser.role === 'guardian'
                        ? '/guardian'
                        : currentUser.role === 'beneficiary'
                        ? '/beneficiary'
                        : '/owner';
                    navigate(roleHome);
                  }}
                >
                  Go to Workspace <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  className="landing-signout-text"
                  onClick={onLogout}
                  title="Sign out"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <>
                <Link href="/login" className="button secondary small-button">
                  <LogIn size={14} />
                  Log In
                </Link>
                <Link href="/signup" className="button primary small-button">
                  <UserPlus size={14} />
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="landing-main">
        {/* Hero Section */}
        <section className="landing-hero-section">
          <div className="landing-hero-container">
            <div className="landing-hero-content">
              <div className="landing-pill">
                <ShieldCheck size={14} className="landing-pill-icon" />
                <span>CRYPTOGRAPHIC CUSTODY · ON-CHAIN INHERITANCE</span>
              </div>

              <h1 className="landing-hero-title">
                Protect what matters today.
                <br />
                <span className="landing-hero-gradient">Pass it on when the time comes.</span>
              </h1>

              <p className="landing-hero-subtitle">
                Heirloom secures your encrypted memories, digital credentials, and vital family documents.
                Protected by client-side math today, guided by trusted guardians tomorrow, and delivered
                to your beneficiary only when strict recovery conditions are met.
              </p>

              <div className="landing-hero-cta-group">
                {currentUser ? (
                  <button
                    type="button"
                    className="button primary landing-cta-main"
                    onClick={() => {
                      const roleHome =
                        currentUser.role === 'guardian'
                          ? '/guardian'
                          : currentUser.role === 'beneficiary'
                          ? '/beneficiary'
                          : '/owner';
                      navigate(roleHome);
                    }}
                  >
                    Enter Your Workspace
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <>
                    <Link href="/signup" className="button primary landing-cta-main">
                      Get Started Free
                      <ArrowRight size={17} />
                    </Link>
                    <Link href="/login" className="button secondary landing-cta-alt">
                      Sign In to Account
                    </Link>
                  </>
                )}
              </div>

              <div className="landing-hero-badges">
                <span className="landing-hero-badge">
                  <CheckCircle2 size={14} /> AES-256 client encryption
                </span>
                <span className="landing-hero-badge">
                  <CheckCircle2 size={14} /> 2-of-3 guardian quorum
                </span>
                <span className="landing-hero-badge">
                  <CheckCircle2 size={14} /> Owner cancellation window
                </span>
              </div>
            </div>

            <div className="landing-hero-visual">
              <div className="landing-illustration-frame">
                <VaultIllustration />
                <div className="landing-visual-floating-card top-card">
                  <Heart size={16} className="visual-card-icon heart" />
                  <div>
                    <strong>Letters for my family</strong>
                    <small>Encrypted on your device</small>
                  </div>
                </div>
                <div className="landing-visual-floating-card bottom-card">
                  <UsersRound size={16} className="visual-card-icon guardians" />
                  <div>
                    <strong>Guardian Quorum</strong>
                    <small>2 independent approvals required</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value Proposition Highlights */}
        <section className="landing-values-section">
          <div className="landing-section-header">
            <span className="landing-section-eyebrow">DESIGNED FOR HUMAN PEACE OF MIND</span>
            <h2>Digital inheritance, done thoughtfully.</h2>
            <p>
              Traditional cloud storage locks families out. Simple password managers create single points of failure.
              Heirloom provides a calm, mathematically sound safety net.
            </p>
          </div>

          <div className="landing-values-grid">
            <div className="landing-value-card">
              <div className="landing-value-icon lilac">
                <LockKeyhole size={22} />
              </div>
              <h3>Zero-Knowledge Client Encryption</h3>
              <p>
                Each vault is sealed on your browser using AES-256-GCM before it ever touches storage.
                Neither the server, the relay, nor any single guardian can view your sensitive files.
              </p>
            </div>

            <div className="landing-value-card">
              <div className="landing-value-icon peach">
                <UsersRound size={22} />
              </div>
              <h3>Shared Circle of Trust</h3>
              <p>
                Your decryption key is split into three encrypted shares using Shamir’s Secret Sharing.
                Reconstruction requires two distinct, verified guardian approvals. No one holds all keys alone.
              </p>
            </div>

            <div className="landing-value-card">
              <div className="landing-value-icon sage">
                <Clock3 size={22} />
              </div>
              <h3>Deliberate Cancellation Window</h3>
              <p>
                If guardians mistakenly open a recovery request, you have an on-chain challenge window
                to stop it with a single signed check-in. You always retain ultimate authority while active.
              </p>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="landing-how-section">
          <div className="landing-section-header">
            <span className="landing-section-eyebrow">FOUR STEP PROTOCOL</span>
            <h2>How Heirloom works</h2>
            <p>
              A clear, verifiable path that balances continuous security with compassionate accessibility.
            </p>
          </div>

          <div className="landing-steps-container">
            <div className="landing-step-row">
              <div className="landing-step-num">01</div>
              <div className="landing-step-content">
                <div className="landing-step-badge">
                  <LockKeyhole size={14} /> STEP 1: SEAL & ENCRYPT
                </div>
                <h3>Encrypt on your device</h3>
                <p>
                  Upload your legacy documents, estate plans, passwords, or personal family letters.
                  A unique cryptographic key encrypts your bytes locally in your browser. The plaintext
                  never leaves your machine.
                </p>
              </div>
              <div className="landing-step-visual">
                <div className="landing-step-art art-1">
                  <FileText size={26} />
                  <span>Unreadable ciphertext stored</span>
                </div>
              </div>
            </div>

            <div className="landing-step-row reverse">
              <div className="landing-step-num">02</div>
              <div className="landing-step-content">
                <div className="landing-step-badge">
                  <UsersRound size={14} /> STEP 2: ASSIGN GUARDIANS
                </div>
                <h3>Distribute to your circle of trust</h3>
                <p>
                  Choose three people you trust—family members, friends, or trusted advisors.
                  The encryption key is divided into three mathematical shares, each re-encrypted
                  exclusively to that guardian’s public key.
                </p>
              </div>
              <div className="landing-step-visual">
                <div className="landing-step-art art-2">
                  <KeyRound size={26} />
                  <span>2 of 3 guardian quorum</span>
                </div>
              </div>
            </div>

            <div className="landing-step-row">
              <div className="landing-step-num">03</div>
              <div className="landing-step-content">
                <div className="landing-step-badge">
                  <Fingerprint size={14} /> STEP 3: CHECK IN PEACEFULLY
                </div>
                <h3>Stay active with effortless check-ins</h3>
                <p>
                  Check in periodically with a signed transaction to reset your vault’s inactivity timer.
                  As long as you remain active, no recovery can ever be initiated by anyone.
                </p>
              </div>
              <div className="landing-step-visual">
                <div className="landing-step-art art-3">
                  <Clock3 size={26} />
                  <span>Configurable check-in interval</span>
                </div>
              </div>
            </div>

            <div className="landing-step-row reverse">
              <div className="landing-step-num">04</div>
              <div className="landing-step-content">
                <div className="landing-step-badge">
                  <ShieldCheck size={14} /> STEP 4: DELIBERATE TRANSFER
                </div>
                <h3>Release to your beneficiary</h3>
                <p>
                  If you become inactive, your beneficiary can request recovery. Two guardians independently
                  verify your status and approve. After the cancellation challenge window elapses, the beneficiary
                  receives the shares and reconstructs the asset locally.
                </p>
              </div>
              <div className="landing-step-visual">
                <div className="landing-step-art art-4">
                  <CheckCircle2 size={26} />
                  <span>Exact byte recovery in browser</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Security & Cryptography Overview */}
        <section id="security" className="landing-security-section">
          <div className="landing-security-card">
            <div className="landing-security-header">
              <div className="landing-security-icon-wrap">
                <ShieldCheck size={28} />
              </div>
              <div>
                <h2>Cryptographic integrity at every layer</h2>
                <p>Built with modern Web Crypto APIs and Ethereum smart contract commitments.</p>
              </div>
            </div>

            <div className="landing-security-specs-grid">
              <div className="spec-item">
                <strong>AES-GCM-256</strong>
                <span>Symmetric payload encryption</span>
              </div>
              <div className="spec-item">
                <strong>RSA-OAEP-4096</strong>
                <span>Guardian share key encapsulation</span>
              </div>
              <div className="spec-item">
                <strong>Shamir Secret Sharing</strong>
                <span>(2, 3) threshold key splitting</span>
              </div>
              <div className="spec-item">
                <strong>Ethereum State Machine</strong>
                <span>Immutable verification of quorum & delays</span>
              </div>
            </div>

            <div className="landing-security-footer">
              <p>
                Heirloom does not hold your master keys. We cannot decrypt your documents, alter your recovery
                rules, or bypass guardian consensus. Math and code enforce your wishes.
              </p>
            </div>
          </div>
        </section>

        {/* Call to Action Banner */}
        <section className="landing-cta-banner">
          <div className="landing-cta-box">
            <div className="landing-cta-sparkle">
              <Sprout size={32} />
            </div>
            <h2>Start your digital legacy today.</h2>
            <p>
              Take ten minutes to protect the memories, accounts, and instructions your loved ones will need.
            </p>
            <div className="landing-cta-buttons">
              {currentUser ? (
                <button
                  type="button"
                  className="button primary landing-cta-white"
                  onClick={() => {
                    const roleHome =
                      currentUser.role === 'guardian'
                        ? '/guardian'
                        : currentUser.role === 'beneficiary'
                        ? '/beneficiary'
                        : '/owner';
                    navigate(roleHome);
                  }}
                >
                  Enter Workspace <ArrowRight size={16} />
                </button>
              ) : (
                <>
                  <Link href="/signup" className="button primary landing-cta-white">
                    Create Your Account <ArrowRight size={16} />
                  </Link>
                  <Link href="/login" className="button secondary landing-cta-outline">
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-container">
          <div className="landing-footer-brand">
            <Brand small />
            <p>Cryptographic custody and thoughtful digital inheritance policies.</p>
          </div>

          <div className="landing-footer-links">
            <div>
              <strong>Product</strong>
              <Link href="/signup">Sign Up</Link>
              <Link href="/login">Log In</Link>
              <a href="#how-it-works">How it works</a>
            </div>
            <div>
              <strong>Security</strong>
              <a href="#security">Encryption Spec</a>
              <a href="#safeguards">Guardian Quorum</a>
              <span>Ethereum Smart Contracts</span>
            </div>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <p>© Heirloom Protocol · Made for the things that outlast us.</p>
          <span>Ethereum & Web Crypto Architecture</span>
        </div>
      </footer>
    </div>
  );
}
