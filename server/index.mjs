import express from 'express';
import { Contract, JsonRpcProvider, verifyMessage, keccak256 } from 'ethers';
import { validateDeployment } from '../shared/chain-safety.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes, randomInt, pbkdf2Sync } from 'node:crypto';
import { digest, identityMessage, releaseMessage } from '../shared/protocol.mjs';
import { validatePackageShape, validateIdentity, validateReleaseContext, validateRecoveryKit, validateRegistration } from './validation.mjs';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch { }
}

const config = JSON.parse(readFileSync(process.env.HEIRLOOM_DEPLOYMENT_FILE ?? '.runtime/deployment.json', 'utf8'));
const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
const contract = new Contract(config.contractAddress, config.abi, provider);
async function verifyDeployment() {
  const [chainId, block, code] = await Promise.all([provider.send('eth_chainId', []), provider.getBlock(config.deploymentBlock), provider.getCode(config.contractAddress)]);
  validateDeployment(config, { chainId: Number(chainId), blockHash: block?.hash, codeHash: keccak256(code) });
}
await verifyDeployment();
const file = `.runtime/relay-${config.deploymentId.slice(2, 18)}.json`;
let data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { identities: {}, packages: {}, releases: {} };
if (!data.identities) data.identities = {};
if (!data.packages) data.packages = {};
if (!data.releases) data.releases = {};
if (!data.users) data.users = {};
if (!data.sessions) data.sessions = {};

if (existsSync('.runtime') && (!Object.keys(data.users).length || !Object.keys(data.sessions).length)) {
  for (const prev of readdirSync('.runtime')) {
    if (prev.startsWith('relay-') && prev.endsWith('.json') && prev !== basename(file)) {
      try {
        const prevData = JSON.parse(readFileSync(`.runtime/${prev}`, 'utf8'));
        if (prevData.users && Object.keys(prevData.users).length) {
          data.users = { ...prevData.users, ...data.users };
        }
        if (prevData.sessions && Object.keys(prevData.sessions).length) {
          data.sessions = { ...prevData.sessions, ...data.sessions };
        }
      } catch {}
    }
  }
}

function save(next = data) {
  if (!next || typeof next !== 'object') {
    throw new Error('Data payload required to persist relay state');
  }
  mkdirSync('.runtime', { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(next));
  renameSync(`${file}.tmp`, file);
  data = next;
}
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
function deployment(p) { if (p.binding.chainId !== config.chainId || !same(p.binding.contract, config.contractAddress)) throw new Error('Wrong chain or contract'); }
function validSignature(message, signature, address) { if (!same(verifyMessage(message, signature), address)) throw new Error('Invalid wallet signature'); }
async function vaultState(id) {
  const v = await contract.getVault(id);
  const guardians = [...v.guardians];
  const approved = [];
  for (const g of guardians) if (await contract.hasApproved(id, v.requestId, g)) approved.push(g);
  return { beneficiary: v.beneficiary, beneficiaryKeyHash: v.beneficiaryKeyHash, commitment: v.commitment, guardians, approved, requestId: Number(v.requestId), status: Number(v.status), finalizedAt: Number(v.finalizedAt) };
}
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002'].includes(origin)) return res.status(403).json({ error: 'Untrusted request origin' });
  res.set('Cache-Control', 'no-store'); next();
});
app.get('/api/config', route(async (_req, res) => {
  await verifyDeployment();
  const block = await provider.getBlock('latest');
  const demoActors = (config.actors || []).map(a => ({ ...a, isDemo: true }));
  const registeredActors = Object.values(data.users || {}).map(u => ({
    address: u.address,
    name: u.name,
    role: u.role,
    initials: u.initials || u.name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'HL',
    isDemo: false
  }));
  const mergedActors = [...demoActors];
  for (const reg of registeredActors) {
    const existingIndex = mergedActors.findIndex(a => same(a.address, reg.address));
    if (existingIndex >= 0) {
      mergedActors[existingIndex] = { ...mergedActors[existingIndex], ...reg };
    } else {
      mergedActors.push(reg);
    }
  }
  res.json({
    ...config,
    actors: mergedActors,
    rpcUrl: config.mode === 'local' ? config.rpcUrl : undefined,
    blockTimestamp: block.timestamp,
    blockNumber: block.number
  });
}));
app.get('/api/identities', (_req, res) => {
  const list = Object.values(data.identities).map(id => {
    const user = Object.values(data.users || {}).find(u => same(u.address, id.address));
    const actor = config.actors?.find(a => same(a.address, id.address));
    const name = user?.name || actor?.name || id.name;
    const role = user?.role || actor?.role || id.role;
    return {
      ...id,
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
    };
  });
  res.json(list);
});
app.post('/api/identities', route(async (req, res) => {
  const identity = req.body; const address = identity.address?.toLowerCase();
  validateIdentity(identity, data.identities[address]);
  validSignature(identityMessage(config, identity.address, identity.publicKey), identity.signature, identity.address);
  const user = Object.values(data.users || {}).find(u => same(u.address, identity.address));
  const actor = config.actors?.find(a => same(a.address, identity.address));
  const recordToSave = {
    ...identity,
    ...(identity.name || user?.name || actor?.name || data.identities[address]?.name ? { name: identity.name || user?.name || actor?.name || data.identities[address]?.name } : {}),
    ...(identity.role || user?.role || actor?.role || data.identities[address]?.role ? { role: identity.role || user?.role || actor?.role || data.identities[address]?.role } : {})
  };
  save({ ...data, identities: { ...data.identities, [address]: recordToSave } }); res.json({ ok: true });
}));
app.get('/api/packages', (_req, res) => res.json(Object.values(data.packages)));
app.get('/api/kits/:vaultId', route(async (req, res) => {
  const { vaultId } = req.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(vaultId)) throw new Error('Invalid vault identifier');
  const p = data.packages[vaultId];
  if (!p) return res.status(404).json({ error: 'Encrypted package missing' });
  deployment(p);
  validateRegistration(p, await vaultState(vaultId));
  res.attachment(`heirloom-kit-${vaultId.slice(2, 10)}.json`);
  res.json({ format: 'heirloom-recovery-kit', version: 1, package: p });
}));
app.post('/api/packages', route(async (req, res) => {
  const p = req.body.package; validatePackageShape(p); deployment(p);
  if (req.body.format) validateRecoveryKit(req.body, config);
  const v = await vaultState(p.binding.vaultId); validateRegistration(p, v);
  const previous = data.packages[p.binding.vaultId];
  if (previous && digest(previous) !== digest(p)) throw new Error('Vault packages are immutable');
  save({ ...data, packages: { ...data.packages, [p.binding.vaultId]: p } }); res.json({ ok: true });
}));
app.get('/api/releases/:vaultId', route(async (req, res) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.vaultId)) throw new Error('Invalid vault identifier');
  res.json(data.releases[req.params.vaultId] ?? []);
}));
app.post('/api/releases', route(async (req, res) => {
  const { release, signature } = req.body;
  const p = data.packages[release?.binding?.vaultId]; if (!p) throw new Error('Encrypted package missing'); deployment(p);
  const v = await vaultState(p.binding.vaultId); validateRegistration(p, v); validateReleaseContext(release, p, v);
  validSignature(releaseMessage(release), signature, release.guardian);
  if (config.mode === 'public') {
    const finalEvents = await contract.queryFilter(contract.filters.RecoveryFinalized(p.binding.vaultId, release.requestId), config.deploymentBlock);
    const event = finalEvents.at(-1); const tip = await provider.getBlockNumber();
    if (!event || tip - event.blockNumber + 1 < config.confirmations) throw new Error(`Wait for ${config.confirmations} chain confirmations before releasing shares`);
  }
  const entries = data.releases[p.binding.vaultId] ?? [];
  const previous = entries.find(e => same(e.release.guardian, release.guardian) && e.release.requestId === release.requestId);
  if (previous && digest(previous.release) !== digest(release)) throw new Error('This guardian already released a share for this request');
  if (!previous) save({ ...data, releases: { ...data.releases, [p.binding.vaultId]: [...entries, { release, signature }] } });
  res.json({ ok: true });
}));
app.post('/api/clock', route(async (req, res) => {
  if (config.mode !== 'local' || config.chainId !== 31337 || Number(await provider.send('eth_chainId', [])) !== 31337) throw new Error('Demo clock is available only on the local development chain');
  const seconds = Number(req.body.seconds); if (!Number.isInteger(seconds) || seconds < 1 || seconds > 31536000) throw new Error('Invalid clock advance');
  await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); res.json({ ok: true });
}));

const otps = new Map();
const verifiedEmails = new Map();

app.post('/api/auth/send-otp', route(async (req, res) => {
  const email = req.body?.email?.trim()?.toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Please enter a valid email address');

  const existing = otps.get(email);
  if (existing && Date.now() < existing.createdAt + 20000) {
    const remaining = Math.ceil((existing.createdAt + 20000 - Date.now()) / 1000);
    throw new Error(`Please wait ${remaining}s before requesting a new verification code`);
  }

  const code = randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  otps.set(email, { code, expiresAt, attempts: 0, createdAt: Date.now() });

  const apiKey = process.env.RESEND_API_KEY || '';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Heirloom <onboarding@resend.dev>';
  const allowDemoCode = config.mode === 'local';
  let emailSent = false;
  let devNotice;

  const plainText = `Your Heirloom verification code is: ${code}

This code will expire in 10 minutes.

Enter this 6-digit code in the Heirloom application to verify your email address and generate your cryptographic custody keys.

If you did not request this code, please disregard this email.

Heirloom Security Team
Protect what matters. Pass it on.`;

  const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Heirloom Security Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f8f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed; background-color: #f7f8f4; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e7ecde; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 14px rgba(45, 55, 40, 0.04);">
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 32px 24px 20px; border-bottom: 1px solid #f2f5ec;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 26px; font-weight: 800; color: #2e3627; letter-spacing: -1.2px; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;">Heirloom</span>
                    <span style="color: #8973b4; font-size: 26px; font-weight: 800;">.</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 5px;">
                    <span style="color: #8c9383; font-size: 11px; letter-spacing: 0.5px;">SECURE DIGITAL INHERITANCE</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 28px 32px;">
              <p style="margin: 0 0 16px; color: #353e2d; font-size: 15px; font-weight: 600; line-height: 1.4;">
                Confirm your email address
              </p>
              <p style="margin: 0 0 24px; color: #6a7460; font-size: 13px; line-height: 1.6;">
                Use the following 6-digit one-time code to complete your registration and initialize your browser encryption keys:
              </p>

              <!-- OTP Code Card -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f7f4fc; border: 1px solid #e7def5; border-radius: 10px; margin-bottom: 24px;">
                <tr>
                  <td align="center" style="padding: 22px 16px;">
                    <div style="font-family: 'Courier New', Courier, monospace, monospace; font-size: 38px; font-weight: 700; color: #433358; letter-spacing: 8px; margin: 0;">
                      ${code}
                    </div>
                    <p style="margin: 8px 0 0; color: #8e7aa9; font-size: 11px; font-weight: 500;">
                      Expires in 10 minutes · Single-use code
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 12px; color: #818a75; font-size: 12px; line-height: 1.6;">
                To keep your vaults and keys secure, never share this code with anyone.
              </p>
              <p style="margin: 0; color: #9aa290; font-size: 11px; line-height: 1.5;">
                If you did not request this email, no account has been activated and you can safely ignore this message.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color: #fcfdfa; border-top: 1px solid #edf1e6; padding: 20px 24px;">
              <p style="margin: 0; color: #9da493; font-size: 11px; line-height: 1.5;">
                © Heirloom Protocol · Cryptographic custody and inheritance policies
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!apiKey) {
    if (!allowDemoCode) {
      otps.delete(email);
      throw new Error('Email delivery is not configured. Contact the app operator.');
    }
    devNotice = `Email delivery is not configured. Test verification code: ${code}`;
  } else try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: `${code} is your Heirloom security code`,
        text: plainText,
        html: htmlContent,
        headers: {
          'X-Entity-Ref-ID': `heirloom-otp-${Date.now()}-${code}`,
        }
      })
    });

    const data = await resendRes.json();
    if (!resendRes.ok) {
      console.warn('Resend API notice:', data);
      const msg = data?.message || '';
      if (allowDemoCode && (msg.includes('testing email') || msg.includes('own email address') || msg.includes('verify a domain') || resendRes.status === 403 || resendRes.status === 422)) {
        devNotice = `Note: Resend trial domain only delivers to the account owner's email. For local testing, your verification code is: ${code}`;
      } else {
        devNotice = `Email delivery notice: ${msg || 'Check email service configuration'}. Test code: ${code}`;
      }
    } else {
      emailSent = true;
    }
  } catch (err) {
    console.error('Email dispatch notice:', err.message);
    if (!allowDemoCode) {
      otps.delete(email);
      throw new Error('Email delivery failed. Contact the app operator or try again later.');
    }
    if (!devNotice) {
      devNotice = `Email delivery warning: ${err.message}. Test verification code: ${code}`;
    }
  }

  res.json({
    ok: true,
    message: emailSent ? 'Verification code sent to your email.' : (devNotice || 'Verification code created.'),
    ...(allowDemoCode && !emailSent ? { devCode: code, devNotice } : {})
  });
}));

app.post('/api/auth/verify-otp', route(async (req, res) => {
  const email = req.body?.email?.trim()?.toLowerCase();
  const code = req.body?.code?.trim();

  if (!email || !code) throw new Error('Email and verification code are required');

  const record = otps.get(email);
  if (!record) throw new Error('No active verification code for this email. Please click "Resend code".');

  if (Date.now() > record.expiresAt) {
    otps.delete(email);
    throw new Error('Verification code has expired. Please request a new one.');
  }

  record.attempts += 1;
  if (record.attempts > 5) {
    otps.delete(email);
    throw new Error('Too many incorrect attempts. Please request a fresh code.');
  }

  if (record.code !== code) {
    const remaining = 5 - record.attempts;
    throw new Error(`Incorrect verification code. ${remaining > 0 ? `${remaining} attempts left.` : 'Please request a new code.'}`);
  }

  otps.delete(email);
  verifiedEmails.set(email, Date.now() + 15 * 60 * 1000);
  res.json({ ok: true, verified: true, message: 'Email address verified successfully.' });
}));

function hashPassword(password, salt) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password must be a non-empty string');
  }
  if (typeof salt !== 'string' || !salt) {
    throw new Error('Account cryptographic salt is missing');
  }
  try {
    return pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  } catch {
    throw new Error('Failed to compute password hash');
  }
}

async function allocateAddress(preferredAddress) {
  if (preferredAddress && /^0x[0-9a-fA-F]{40}$/.test(preferredAddress)) {
    return preferredAddress.toLowerCase();
  }
  if (config.mode === 'local') {
    try {
      const allAccounts = await provider.listAccounts();
      const usedAddresses = new Set([
        ...config.actors.map(a => a.address.toLowerCase()),
        ...Object.values(data.users || {}).map(u => u.address.toLowerCase())
      ]);
      const available = allAccounts.find(a => !usedAddresses.has(a.address.toLowerCase()));
      if (available) return available.address.toLowerCase();
    } catch { }
  }
  return `0x${randomBytes(20).toString('hex')}`.toLowerCase();
}

app.post('/api/auth/register', route(async (req, res) => {
  const { name, email, password, role, address } = req.body || {};
  const cleanEmail = email?.trim()?.toLowerCase();
  const cleanName = name?.trim();
  const cleanRole = ['owner', 'beneficiary', 'guardian'].includes(role) ? role : 'owner';

  if (!cleanName) throw new Error('Full name is required');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Valid email address is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

  // Verify email was verified via OTP
  const isVerified = verifiedEmails.has(cleanEmail) && Date.now() < verifiedEmails.get(cleanEmail);
  if (!isVerified) {
    throw new Error('Please verify your email address with the verification code first.');
  }

  const users = data.users || {};
  if (users[cleanEmail]) {
    throw new Error('An account with this email address already exists. Please log in.');
  }

  const assignedAddress = await allocateAddress(address);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const initials = cleanName.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'HL';

  const user = {
    id: `usr_${randomBytes(8).toString('hex')}`,
    name: cleanName,
    email: cleanEmail,
    role: cleanRole,
    address: assignedAddress,
    initials,
    salt,
    passwordHash,
    createdAt: Date.now()
  };

  const session = {
    userId: user.id,
    email: user.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 86400 * 1000
  };

  const nextIdentities = { ...data.identities };
  if (nextIdentities[assignedAddress]) {
    nextIdentities[assignedAddress] = {
      ...nextIdentities[assignedAddress],
      name: cleanName,
      role: cleanRole
    };
  }

  save({
    ...data,
    identities: nextIdentities,
    users: { ...(data.users || {}), [cleanEmail]: user },
    sessions: { ...(data.sessions || {}), [token]: session }
  });
  verifiedEmails.delete(cleanEmail);

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      address: user.address,
      initials: user.initials
    }
  });
}));

app.post('/api/auth/login', route(async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = email?.trim()?.toLowerCase();
  if (!cleanEmail || typeof password !== 'string' || !password) {
    throw new Error('Email and password are required');
  }

  data.users = data.users || {};
  const user = data.users[cleanEmail];
  if (!user) throw new Error('Invalid email or password');

  if (!user.salt || !user.passwordHash) {
    throw new Error('Invalid account configuration. Please re-register.');
  }

  let computedHash;
  try {
    computedHash = hashPassword(password, user.salt);
  } catch {
    throw new Error('Invalid email or password');
  }

  if (computedHash !== user.passwordHash) {
    throw new Error('Invalid email or password');
  }

  const token = randomBytes(32).toString('hex');
  const session = {
    userId: user.id,
    email: user.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 86400 * 1000
  };
  save({
    ...data,
    sessions: { ...(data.sessions || {}), [token]: session }
  });

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      address: user.address,
      initials: user.initials
    }
  });
}));

app.post('/api/auth/demo-login', route(async (req, res) => {
  if (config.mode !== 'local') throw new Error('Demo login is available on local evaluation network only');
  const { address } = req.body || {};
  const actor = config.actors?.find(a => same(a.address, address));
  if (!actor) throw new Error('Demo actor not found');

  const token = `demo_tok_${randomBytes(24).toString('hex')}`;
  const session = {
    userId: `demo_${actor.address.toLowerCase()}`,
    email: `${actor.name.toLowerCase().replace(/\s+/g, '.')}@heirloom.local`,
    isDemo: true,
    actorAddress: actor.address,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 86400 * 1000
  };
  save({
    ...data,
    sessions: { ...(data.sessions || {}), [token]: session }
  });

  res.json({
    ok: true,
    token,
    user: {
      id: `demo_${actor.address.toLowerCase()}`,
      name: actor.name,
      email: `${actor.name.toLowerCase().replace(/\s+/g, '.')}@heirloom.local`,
      role: actor.role,
      address: actor.address,
      initials: actor.initials,
      isDemo: true
    }
  });
}));

app.get('/api/auth/session', route(async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;
  if (!token) return res.json({ ok: false, user: null });

  data.sessions = data.sessions || {};
  const session = data.sessions[token];
  if (!session || Date.now() > session.expiresAt) {
    if (session) delete data.sessions[token];
    return res.json({ ok: false, user: null });
  }

  if (session.isDemo && session.actorAddress) {
    const actor = config.actors?.find(a => same(a.address, session.actorAddress));
    if (actor) {
      return res.json({
        ok: true,
        user: {
          id: session.userId,
          name: actor.name,
          email: session.email,
          role: actor.role,
          address: actor.address,
          initials: actor.initials,
          isDemo: true
        }
      });
    }
  }

  data.users = data.users || {};
  const user = data.users[session.email];
  if (!user) return res.json({ ok: false, user: null });

  res.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      address: user.address,
      initials: user.initials
    }
  });
}));

app.post('/api/auth/logout', route(async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body?.token;
  if (token && data.sessions?.[token]) {
    const nextSessions = { ...data.sessions };
    delete nextSessions[token];
    save({ ...data, sessions: nextSessions });
  }
  res.json({ ok: true });
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, mode: config.mode }));
app.use(express.static('dist'));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && existsSync('dist/index.html')) {
    return res.sendFile('index.html', { root: 'dist' });
  }
  next();
});
app.use((error, _req, res, _next) => { res.status(400).json({ error: error.reason ?? error.shortMessage ?? error.message ?? 'Request rejected' }); });
const port = Number(process.env.HEIRLOOM_RELAY_PORT ?? 3001);
app.listen(port, '127.0.0.1', () => console.log(`Encrypted relay → http://127.0.0.1:${port} (${config.mode})`));
