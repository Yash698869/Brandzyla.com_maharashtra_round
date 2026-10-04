import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import pg from 'pg';

const { Pool } = pg;
const DEPLOYMENT_ID = /^0x[0-9a-f]{64}$/;

function evidenceDeploymentId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!DEPLOYMENT_ID.test(normalized)) throw new Error('Evidence storage requires a valid deploymentId');
  return normalized;
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    address: row.address,
    initials: row.initials,
    salt: row.salt,
    passwordHash: row.passwordHash ?? row.password_hash ?? row.passwordhash,
    createdAt: Number(row.createdAt ?? row.created_at ?? row.createdat)
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  const rawDemo = row.isDemo ?? row.is_demo ?? row.isdemo;
  const isDemo = rawDemo === true || rawDemo === 'true' || rawDemo === 1 || rawDemo === '1';
  const actorAddress = row.actorAddress ?? row.actor_address ?? row.actoraddress;
  return {
    token: row.token,
    userId: row.userId ?? row.user_id ?? row.userid,
    email: row.email,
    ...(isDemo ? { isDemo: true } : {}),
    ...(actorAddress ? { actorAddress } : {}),
    createdAt: Number(row.createdAt ?? row.created_at ?? row.createdat),
    expiresAt: Number(row.expiresAt ?? row.expires_at ?? row.expiresat)
  };
}

function mapIdentityRow(row) {
  if (!row) return null;
  const pub = row.publicKey ?? row.public_key ?? row.publickey;
  return {
    address: row.address,
    publicKey: typeof pub === 'string' ? JSON.parse(pub) : pub,
    signature: row.signature,
    ...(row.name ? { name: row.name } : {}),
    ...(row.role ? { role: row.role } : {})
  };
}

function mapPackageRow(row) {
  if (!row) return null;
  const p = row.payload ?? row.package;
  return typeof p === 'string' ? JSON.parse(p) : p;
}

function mapReleaseRow(row) {
  if (!row) return null;
  const r = row.payload ?? row.release;
  return typeof r === 'string' ? JSON.parse(r) : r;
}

export class PostgresStorage {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.type = 'postgres';
    this.isPostgres = true;
    this.options = options;
  }

  async init() {
    const client = await this.pool.connect();
    try {
      const statements = [
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          address TEXT NOT NULL,
          initials TEXT NOT NULL,
          salt TEXT NOT NULL,
          "passwordHash" TEXT NOT NULL,
          "createdAt" BIGINT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_users_address ON users (address)`,
        `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
        `CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          email TEXT NOT NULL,
          "isDemo" BOOLEAN DEFAULT FALSE,
          "actorAddress" TEXT,
          "createdAt" BIGINT NOT NULL,
          "expiresAt" BIGINT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions ("expiresAt")`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions (email)`,
        `CREATE TABLE IF NOT EXISTS identities (
          address TEXT PRIMARY KEY,
          "publicKey" JSONB NOT NULL,
          signature TEXT,
          name TEXT,
          role TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_identities_address ON identities (address)`,
        `CREATE TABLE IF NOT EXISTS packages (
          "vaultId" TEXT PRIMARY KEY,
          payload JSONB NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS releases (
          id BIGSERIAL,
          "vaultId" TEXT NOT NULL,
          guardian TEXT NOT NULL,
          "requestId" BIGINT NOT NULL,
          payload JSONB NOT NULL,
          "createdAt" BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY ("vaultId", guardian, "requestId")
        )`,
        `CREATE INDEX IF NOT EXISTS idx_releases_vault_id ON releases ("vaultId")`,
        // Versioned scoped tables intentionally leave legacy unscoped evidence unreadable.
        `CREATE TABLE IF NOT EXISTS evidence_enrollments_v2 (
          "deploymentId" TEXT NOT NULL,
          "vaultId" TEXT NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY ("deploymentId", "vaultId")
        )`,
        `CREATE TABLE IF NOT EXISTS evidence_receipts_v2 (
          "deploymentId" TEXT NOT NULL,
          "vaultId" TEXT NOT NULL,
          "requestId" BIGINT NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY ("deploymentId", "vaultId", "requestId")
        )`
      ];

      for (const statement of statements) {
        await client.query(statement);
      }
    } finally {
      client.release();
    }
  }

  async getUsers() {
    const res = await this.pool.query('SELECT * FROM users ORDER BY "createdAt" ASC');
    return res.rows.map(mapUserRow);
  }

  async getUserByEmail(email) {
    if (!email) return null;
    const res = await this.pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    return mapUserRow(res.rows[0]);
  }

  async getUserByAddress(address) {
    if (!address) return null;
    const res = await this.pool.query('SELECT * FROM users WHERE LOWER(address) = LOWER($1)', [address.trim()]);
    return mapUserRow(res.rows[0]);
  }

  async createUser(user) {
    await this.pool.query(
      `INSERT INTO users (id, email, name, role, address, initials, salt, "passwordHash", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.id,
        user.email.trim().toLowerCase(),
        user.name,
        user.role,
        user.address.trim().toLowerCase(),
        user.initials,
        user.salt,
        user.passwordHash,
        user.createdAt
      ]
    );
  }

  async saveSession(token, session) {
    await this.pool.query(
      `INSERT INTO sessions (token, "userId", email, "isDemo", "actorAddress", "createdAt", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (token) DO UPDATE SET
         "userId" = EXCLUDED."userId",
         email = EXCLUDED.email,
         "isDemo" = EXCLUDED."isDemo",
         "actorAddress" = EXCLUDED."actorAddress",
         "createdAt" = EXCLUDED."createdAt",
         "expiresAt" = EXCLUDED."expiresAt"`,
      [
        token,
        session.userId,
        session.email.trim().toLowerCase(),
        Boolean(session.isDemo),
        session.actorAddress ?? null,
        session.createdAt,
        session.expiresAt
      ]
    );
  }

  async getSession(token) {
    if (!token) return null;
    const res = await this.pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    return mapSessionRow(res.rows[0]);
  }

  async deleteSession(token) {
    if (!token) return;
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async getIdentities() {
    const res = await this.pool.query('SELECT * FROM identities');
    return res.rows.map(mapIdentityRow);
  }

  async getIdentity(address) {
    if (!address) return null;
    const res = await this.pool.query('SELECT * FROM identities WHERE LOWER(address) = LOWER($1)', [address.trim()]);
    return mapIdentityRow(res.rows[0]);
  }

  async saveIdentity(identity) {
    const address = identity.address.trim().toLowerCase();
    await this.pool.query(
      `INSERT INTO identities (address, "publicKey", signature, name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE SET
         "publicKey" = EXCLUDED."publicKey",
         signature = EXCLUDED.signature,
         name = EXCLUDED.name,
         role = EXCLUDED.role`,
      [
        address,
        JSON.stringify(identity.publicKey),
        identity.signature ?? null,
        identity.name ?? null,
        identity.role ?? null
      ]
    );
  }

  async getPackages() {
    const res = await this.pool.query('SELECT payload FROM packages');
    return res.rows.map(mapPackageRow);
  }

  async getPackage(vaultId) {
    if (!vaultId) return null;
    const res = await this.pool.query('SELECT payload FROM packages WHERE LOWER("vaultId") = LOWER($1)', [vaultId.trim()]);
    return mapPackageRow(res.rows[0]);
  }

  async savePackage(vaultId, pkg) {
    const vId = vaultId.trim().toLowerCase();
    await this.pool.query(
      `INSERT INTO packages ("vaultId", payload)
       VALUES ($1, $2)
       ON CONFLICT ("vaultId") DO UPDATE SET payload = EXCLUDED.payload`,
      [vId, JSON.stringify(pkg)]
    );
  }

  async getReleases(vaultId) {
    if (!vaultId) return [];
    const res = await this.pool.query(
      'SELECT payload FROM releases WHERE LOWER("vaultId") = LOWER($1) ORDER BY "createdAt" ASC, id ASC',
      [vaultId.trim()]
    );
    return res.rows.map(mapReleaseRow);
  }

  async saveRelease(vaultId, releaseEntry) {
    const vId = vaultId.trim().toLowerCase();
    const guardian = releaseEntry.release.guardian.trim().toLowerCase();
    const requestId = Number(releaseEntry.release.requestId);
    const createdAt = Date.now();
    await this.pool.query(
      `INSERT INTO releases ("vaultId", guardian, "requestId", payload, "createdAt")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("vaultId", guardian, "requestId") DO UPDATE SET
         payload = EXCLUDED.payload,
         "createdAt" = EXCLUDED."createdAt"`,
      [vId, guardian, requestId, JSON.stringify(releaseEntry), createdAt]
    );
  }

  async getEvidenceEnrollment(vaultId) {
    const deploymentId = evidenceDeploymentId(this.options.deploymentId);
    const res = await this.pool.query(
      'SELECT payload FROM evidence_enrollments_v2 WHERE "deploymentId" = $1 AND LOWER("vaultId") = LOWER($2)',
      [deploymentId, vaultId.trim()]
    );
    return res.rows[0] ? mapPackageRow(res.rows[0]) : null;
  }

  async saveEvidenceEnrollment(vaultId, record) {
    const deploymentId = evidenceDeploymentId(this.options.deploymentId);
    const cleanVaultId = vaultId.trim().toLowerCase();
    await this.pool.query(
      'INSERT INTO evidence_enrollments_v2 ("deploymentId", "vaultId", payload) VALUES ($1, $2, $3) ON CONFLICT ("deploymentId", "vaultId") DO NOTHING',
      [deploymentId, cleanVaultId, JSON.stringify(record)]
    );
    const saved = await this.getEvidenceEnrollment(cleanVaultId);
    if (!isDeepStrictEqual(saved, record)) throw new Error('Evidence identity is already enrolled and immutable');
  }

  async getEvidenceReceipt(vaultId, requestId) {
    const deploymentId = evidenceDeploymentId(this.options.deploymentId);
    const res = await this.pool.query(
      'SELECT payload FROM evidence_receipts_v2 WHERE "deploymentId" = $1 AND LOWER("vaultId") = LOWER($2) AND "requestId" = $3',
      [deploymentId, vaultId.trim(), Number(requestId)]
    );
    return res.rows[0] ? mapPackageRow(res.rows[0]) : null;
  }

  async saveEvidenceReceipt(vaultId, requestId, receipt) {
    const deploymentId = evidenceDeploymentId(this.options.deploymentId);
    await this.pool.query(
      `INSERT INTO evidence_receipts_v2 ("deploymentId", "vaultId", "requestId", payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT ("deploymentId", "vaultId", "requestId") DO UPDATE SET payload = EXCLUDED.payload`,
      [deploymentId, vaultId.trim().toLowerCase(), Number(requestId), JSON.stringify(receipt)]
    );
  }

  async close() {
    await this.pool.end();
  }
}

export class FileStorage {
  constructor(options = {}) {
    this.type = 'file';
    this.isPostgres = false;
    this.options = options;
    const deploymentId = options.deploymentId || '0x0000000000000000';
    this.file = options.file || `.runtime/relay-${deploymentId.slice(2, 18)}.json`;
    this.data = { identities: {}, packages: {}, releases: {}, users: {}, sessions: {}, evidenceEnrollments: {}, evidenceReceipts: {} };
  }

  async init() {
    const file = this.file;
    let data = { identities: {}, packages: {}, releases: {}, users: {}, sessions: {} };
    if (existsSync(file)) {
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        data = { identities: {}, packages: {}, releases: {}, users: {}, sessions: {} };
      }
    }
    if (!data.identities) data.identities = {};
    if (!data.packages) data.packages = {};
    if (!data.releases) data.releases = {};
    if (!data.users) data.users = {};
    if (!data.sessions) data.sessions = {};
    if (!data.evidenceEnrollments) data.evidenceEnrollments = {};
    if (!data.evidenceReceipts) data.evidenceReceipts = {};

    const dir = dirname(file);
    if (existsSync(dir) && (!Object.keys(data.users).length || !Object.keys(data.sessions).length)) {
      try {
        for (const prev of readdirSync(dir)) {
          if (prev.startsWith('relay-') && prev.endsWith('.json') && prev !== basename(file)) {
            try {
              const prevData = JSON.parse(readFileSync(join(dir, prev), 'utf8'));
              if (prevData.users && Object.keys(prevData.users).length) {
                data.users = { ...prevData.users, ...data.users };
              }
              if (prevData.sessions && Object.keys(prevData.sessions).length) {
                data.sessions = { ...prevData.sessions, ...data.sessions };
              }
            } catch {}
          }
        }
      } catch {}
    }
    this.data = data;
  }

  save(next = this.data) {
    if (!next || typeof next !== 'object') {
      throw new Error('Data payload required to persist relay state');
    }
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next));
    renameSync(`${this.file}.tmp`, this.file);
    this.data = next;
  }

  getData() {
    return this.data;
  }

  async getUsers() {
    return Object.values(this.data.users || {});
  }

  async getUserByEmail(email) {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    return this.data.users?.[clean] || Object.values(this.data.users || {}).find(u => u.email?.toLowerCase() === clean) || null;
  }

  async getUserByAddress(address) {
    if (!address) return null;
    const clean = address.trim().toLowerCase();
    return Object.values(this.data.users || {}).find(u => u.address?.toLowerCase() === clean) || null;
  }

  async createUser(user) {
    const cleanEmail = user.email.trim().toLowerCase();
    const nextUsers = { ...(this.data.users || {}), [cleanEmail]: user };
    this.save({ ...this.data, users: nextUsers });
  }

  async saveSession(token, session) {
    const nextSessions = { ...(this.data.sessions || {}), [token]: session };
    this.save({ ...this.data, sessions: nextSessions });
  }

  async getSession(token) {
    if (!token) return null;
    return this.data.sessions?.[token] || null;
  }

  async deleteSession(token) {
    if (!token || !this.data.sessions?.[token]) return;
    const nextSessions = { ...this.data.sessions };
    delete nextSessions[token];
    this.save({ ...this.data, sessions: nextSessions });
  }

  async getIdentities() {
    return Object.values(this.data.identities || {});
  }

  async getIdentity(address) {
    if (!address) return null;
    const clean = address.trim().toLowerCase();
    return this.data.identities?.[clean] || null;
  }

  async saveIdentity(identity) {
    const address = identity.address.trim().toLowerCase();
    const nextIdentities = { ...(this.data.identities || {}), [address]: identity };
    this.save({ ...this.data, identities: nextIdentities });
  }

  async getPackages() {
    return Object.values(this.data.packages || {});
  }

  async getPackage(vaultId) {
    if (!vaultId) return null;
    const clean = vaultId.trim().toLowerCase();
    return this.data.packages?.[clean] || this.data.packages?.[vaultId] || null;
  }

  async savePackage(vaultId, pkg) {
    const clean = vaultId.trim().toLowerCase();
    const nextPackages = { ...(this.data.packages || {}), [clean]: pkg };
    this.save({ ...this.data, packages: nextPackages });
  }

  async getReleases(vaultId) {
    if (!vaultId) return [];
    const clean = vaultId.trim().toLowerCase();
    return this.data.releases?.[clean] ?? this.data.releases?.[vaultId] ?? [];
  }

  async saveRelease(vaultId, releaseEntry) {
    const cleanVaultId = vaultId.trim().toLowerCase();
    const entries = this.data.releases?.[cleanVaultId] ?? this.data.releases?.[vaultId] ?? [];
    const guardian = releaseEntry.release?.guardian?.trim().toLowerCase();
    const requestId = Number(releaseEntry.release?.requestId);
    const existingIdx = entries.findIndex(e =>
      e.release?.guardian?.trim().toLowerCase() === guardian &&
      Number(e.release?.requestId) === requestId
    );
    let nextEntries;
    if (existingIdx >= 0) {
      nextEntries = [...entries];
      nextEntries[existingIdx] = releaseEntry;
    } else {
      nextEntries = [...entries, releaseEntry];
    }
    const nextReleases = { ...(this.data.releases || {}), [cleanVaultId]: nextEntries };
    this.save({ ...this.data, releases: nextReleases });
  }

  async getEvidenceEnrollment(vaultId) {
    const key = `${evidenceDeploymentId(this.options.deploymentId)}:${vaultId.trim().toLowerCase()}`;
    return this.data.evidenceEnrollments?.[key] ?? null;
  }

  async saveEvidenceEnrollment(vaultId, record) {
    const key = `${evidenceDeploymentId(this.options.deploymentId)}:${vaultId.trim().toLowerCase()}`;
    const prior = this.data.evidenceEnrollments?.[key];
    if (prior) {
      if (!isDeepStrictEqual(prior, record)) throw new Error('Evidence identity is already enrolled and immutable');
      return;
    }
    this.save({ ...this.data, evidenceEnrollments: { ...this.data.evidenceEnrollments, [key]: record } });
  }

  async getEvidenceReceipt(vaultId, requestId) {
    const key = `${evidenceDeploymentId(this.options.deploymentId)}:${vaultId.trim().toLowerCase()}:${Number(requestId)}`;
    return this.data.evidenceReceipts?.[key] ?? null;
  }

  async saveEvidenceReceipt(vaultId, requestId, receipt) {
    const key = `${evidenceDeploymentId(this.options.deploymentId)}:${vaultId.trim().toLowerCase()}:${Number(requestId)}`;
    this.save({ ...this.data, evidenceReceipts: { ...this.data.evidenceReceipts, [key]: receipt } });
  }

  async close() {
    // No-op for file storage
  }
}

export async function initStorage(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (options.pool) {
    const storage = new PostgresStorage(options.pool, options);
    await storage.init();
    return storage;
  }

  const isPostgresUrl = typeof databaseUrl === 'string' &&
    databaseUrl.trim().length > 0 &&
    !['undefined', 'null', 'false', '0'].includes(databaseUrl.trim().toLowerCase());

  if (isPostgresUrl) {
    const cleanUrl = databaseUrl.trim();
    const poolConfig = {
      connectionString: cleanUrl,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10000,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
      max: options.maxPoolSize ?? 10
    };

    const isSslDisabled = process.env.PGSSLMODE === 'disable' ||
      process.env.DATABASE_SSL === 'false' ||
      process.env.DATABASE_SSL === '0' ||
      cleanUrl.includes('sslmode=disable');

    const isSslRequired = !isSslDisabled && (
      process.env.PGSSLMODE === 'require' ||
      process.env.PGSSLMODE === 'no-verify' ||
      process.env.DATABASE_SSL === 'true' ||
      process.env.DATABASE_SSL === '1' ||
      cleanUrl.includes('sslmode=require') ||
      cleanUrl.includes('sslmode=no-verify') ||
      cleanUrl.includes('ssl=true') ||
      cleanUrl.includes('ssl=1')
    );

    if (options.ssl !== undefined) {
      poolConfig.ssl = options.ssl;
    } else if (isSslDisabled) {
      poolConfig.ssl = false;
    } else if (isSslRequired) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }

    const pool = new Pool(poolConfig);
    pool.on('error', (err) => {
      console.error('PostgreSQL client pool idle client error:', err.message);
    });

    const storage = new PostgresStorage(pool, options);
    try {
      await storage.init();
      return storage;
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  const fileStorage = new FileStorage(options);
  await fileStorage.init();
  return fileStorage;
}
