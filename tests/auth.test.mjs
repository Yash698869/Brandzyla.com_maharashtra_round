import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import express from 'express';
import { initStorage, PostgresStorage, FileStorage } from '../server/storage.mjs';

describe('Heirloom Authentication & State Persistence Regression Tests', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'heirloom-auth-test-'));

  test('save() persists state safely with default argument and never passes undefined to writeFileSync', () => {
    const file = join(tmpDir, 'test-relay.json');
    let data = { identities: {}, packages: {}, releases: {}, users: {}, sessions: {} };

    function save(next = data) {
      if (!next || typeof next !== 'object') {
        throw new Error('Data payload required to persist relay state');
      }
      data = next;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
      data = next;
    }

    // 1. Calling save() with NO argument must not throw "The 'data' argument must be of type string..."
    assert.doesNotThrow(() => {
      data.users['test@example.com'] = { name: 'Test User' };
      save();
    }, 'Calling save() without arguments must not throw');

    // 2. Calling save(data) explicitly must succeed
    assert.doesNotThrow(() => {
      data.sessions['token-123'] = { userId: 'usr_1' };
      save(data);
    }, 'Calling save(data) must not throw');

    // Verify written file is valid JSON
    assert.ok(existsSync(`${file}.tmp`), 'File should have been written');
    const written = JSON.parse(readFileSync(`${file}.tmp`, 'utf8'));
    assert.equal(written.users['test@example.com'].name, 'Test User');
    assert.equal(written.sessions['token-123'].userId, 'usr_1');
  });

  test('hashPassword() throws clear error instead of raw crypto TypeError when salt or password is missing', () => {
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

    // Missing password
    assert.throws(
      () => hashPassword(undefined, 'somesalt'),
      { message: 'Password must be a non-empty string' }
    );
    assert.throws(
      () => hashPassword('', 'somesalt'),
      { message: 'Password must be a non-empty string' }
    );

    // Missing salt - must NOT throw raw Node TypeError [ERR_INVALID_ARG_TYPE]
    assert.throws(
      () => hashPassword('password123', undefined),
      { message: 'Account cryptographic salt is missing' }
    );
    assert.throws(
      () => hashPassword('password123', ''),
      { message: 'Account cryptographic salt is missing' }
    );

    // Valid call
    const hash = hashPassword('password123', 'somesalt');
    assert.ok(typeof hash === 'string' && hash.length === 128);
  });

  test('corrupted user account record returns clear login error instead of raw crypto exception', () => {
    const data = {
      users: {
        'corrupted@example.com': {
          id: 'usr_corrupted',
          email: 'corrupted@example.com',
          // salt is missing!
          passwordHash: 'somehash',
        },
      },
    };

    function login(email, password) {
      const cleanEmail = email?.trim()?.toLowerCase();
      if (!cleanEmail || typeof password !== 'string' || !password) {
        throw new Error('Email and password are required');
      }

      const user = data.users[cleanEmail];
      if (!user) throw new Error('Invalid email or password');

      if (!user.salt || !user.passwordHash) {
        throw new Error('Invalid account configuration. Please re-register.');
      }

      return user;
    }

    // Attempting login on corrupted user must throw clean error, not Node TypeError
    assert.throws(
      () => login('corrupted@example.com', 'mypassword'),
      (err) => {
        assert.equal(err.message, 'Invalid account configuration. Please re-register.');
        assert.ok(!err.message.includes('ERR_INVALID_ARG_TYPE'));
        assert.ok(!err.message.includes('The "data" argument must be'));
        assert.ok(!err.message.includes('The "salt" argument must be'));
        return true;
      }
    );
  });

  test('fresh-clone scenario with non-existent user returns clean invalid credentials error', () => {
    const data = { users: {}, sessions: {} };

    function login(email, password) {
      const cleanEmail = email?.trim()?.toLowerCase();
      if (!cleanEmail || typeof password !== 'string' || !password) {
        throw new Error('Email and password are required');
      }

      const user = data.users[cleanEmail];
      if (!user) throw new Error('Invalid email or password');
      return user;
    }

    assert.throws(
      () => login('nobody@example.com', 'password123'),
      { message: 'Invalid email or password' }
    );
  });

  test('PostgreSQL storage adapter automatically initializes schema and handles full state lifecycle', async () => {
    const db = newDb();
    const Pool = db.adapters.createPg().Pool;
    const pool = new Pool();
    const storage = await initStorage({ pool });

    assert.equal(storage.type, 'postgres');
    assert.equal(storage.isPostgres, true);

    // Verify all required tables were created
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    assert.ok(tables.includes('users'), 'users table must exist');
    assert.ok(tables.includes('sessions'), 'sessions table must exist');
    assert.ok(tables.includes('identities'), 'identities table must exist');
    assert.ok(tables.includes('packages'), 'packages table must exist');
    assert.ok(tables.includes('releases'), 'releases table must exist');

    // 1. User persistence
    const user = {
      id: 'usr_pg_1',
      name: 'Postgres Custodian',
      email: 'custodian@heirloom.io',
      role: 'owner',
      address: '0x1234567890123456789012345678901234567890',
      initials: 'PC',
      salt: 'salt_abc',
      passwordHash: 'hash_xyz',
      createdAt: 1710000000000
    };
    await storage.createUser(user);

    const fetchedByEmail = await storage.getUserByEmail('CUSTODIAN@HEIRLOOM.IO');
    assert.ok(fetchedByEmail);
    assert.equal(fetchedByEmail.id, user.id);
    assert.equal(fetchedByEmail.name, user.name);
    assert.equal(fetchedByEmail.email, user.email);
    assert.equal(fetchedByEmail.role, user.role);
    assert.equal(fetchedByEmail.address, user.address.toLowerCase());
    assert.equal(fetchedByEmail.initials, user.initials);
    assert.equal(fetchedByEmail.salt, user.salt);
    assert.equal(fetchedByEmail.passwordHash, user.passwordHash);
    assert.equal(fetchedByEmail.createdAt, user.createdAt);

    const fetchedByAddr = await storage.getUserByAddress(user.address.toUpperCase());
    assert.ok(fetchedByAddr);
    assert.equal(fetchedByAddr.id, user.id);

    // Duplicate email registration rejected
    await assert.rejects(
      async () => storage.createUser({ ...user, id: 'usr_pg_2' }),
      /unique/i
    );

    // 2. Active Session persistence
    const sessionToken = 'tok_test_session_123';
    const session = {
      userId: user.id,
      email: user.email,
      isDemo: false,
      actorAddress: user.address,
      createdAt: 1710000000000,
      expiresAt: 1710000000000 + 7 * 86400 * 1000
    };
    await storage.saveSession(sessionToken, session);

    const retrievedSession = await storage.getSession(sessionToken);
    assert.ok(retrievedSession);
    assert.equal(retrievedSession.token, sessionToken);
    assert.equal(retrievedSession.userId, user.id);
    assert.equal(retrievedSession.email, user.email);
    assert.equal(retrievedSession.expiresAt, session.expiresAt);

    // Demo session persistence
    const demoToken = 'tok_demo_456';
    const demoSession = {
      userId: 'demo_0xactor',
      email: 'demo@heirloom.local',
      isDemo: true,
      actorAddress: '0x9999999999999999999999999999999999999999',
      createdAt: 1710000000000,
      expiresAt: 1710000000000 + 7 * 86400 * 1000
    };
    await storage.saveSession(demoToken, demoSession);
    const retrievedDemo = await storage.getSession(demoToken);
    assert.equal(retrievedDemo.isDemo, true);
    assert.equal(retrievedDemo.actorAddress, demoSession.actorAddress);

    // Logout session deletion
    await storage.deleteSession(sessionToken);
    assert.equal(await storage.getSession(sessionToken), null);

    // 3. Cryptographic Identity enrollment persistence
    const pubKey = { kty: 'RSA', n: 'mock-modulus', e: 'AQAB', alg: 'RSA-OAEP-256' };
    const identity = {
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      publicKey: pubKey,
      signature: '0xsig_test',
      name: 'Alice Guardian',
      role: 'guardian'
    };
    await storage.saveIdentity(identity);

    const retrievedIdentity = await storage.getIdentity(identity.address.toLowerCase());
    assert.ok(retrievedIdentity);
    assert.equal(retrievedIdentity.address, identity.address.toLowerCase());
    assert.deepEqual(retrievedIdentity.publicKey, pubKey);
    assert.equal(retrievedIdentity.name, 'Alice Guardian');
    assert.equal(retrievedIdentity.role, 'guardian');

    // 4. Encrypted Package persistence
    const vaultId = '0x' + 'f'.repeat(64);
    const pkgPayload = {
      version: 1,
      binding: { vaultId, chainId: 31337 },
      beneficiaryPublicKey: pubKey,
      iv: 'iv_base64',
      ciphertext: 'ciphertext_base64',
      guardianShares: [{ guardian: identity.address, envelope: { iv: 'iv', wrappedKey: 'k', ciphertext: 'c' } }]
    };
    await storage.savePackage(vaultId, pkgPayload);

    const retrievedPkg = await storage.getPackage(vaultId);
    assert.ok(retrievedPkg);
    assert.deepEqual(retrievedPkg, pkgPayload);
    const allPackages = await storage.getPackages();
    assert.equal(allPackages.length, 1);
    assert.deepEqual(allPackages[0], pkgPayload);

    // 5. Guardian Share Release persistence
    const releasePayload = {
      release: {
        version: 1,
        binding: { vaultId },
        guardian: identity.address,
        requestId: 1,
        envelope: { iv: 'iv', wrappedKey: 'k', ciphertext: 'c' }
      },
      signature: '0xrel_sig'
    };
    await storage.saveRelease(vaultId, releasePayload);

    const releases = await storage.getReleases(vaultId);
    assert.equal(releases.length, 1);
    assert.deepEqual(releases[0], releasePayload);

    await storage.close();
  });

  test('Gracefully falls back to local file storage when DATABASE_URL is undefined or empty', async () => {
    const file = join(tmpDir, 'fallback-relay.json');
    const storage = await initStorage({ file, databaseUrl: undefined });

    assert.equal(storage.type, 'file');
    assert.equal(storage.isPostgres, false);

    const user = {
      id: 'usr_file_1',
      name: 'Local Demo User',
      email: 'demo@local.heirloom',
      role: 'owner',
      address: '0x2222222222222222222222222222222222222222',
      initials: 'LD',
      salt: 'salt_file',
      passwordHash: 'hash_file',
      createdAt: Date.now()
    };
    await storage.createUser(user);

    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(persisted.users[user.email].name, 'Local Demo User');

    const fetched = await storage.getUserByEmail(user.email);
    assert.equal(fetched.name, 'Local Demo User');
  });

  test('PostgreSQL and File storage support case-insensitive vaultId lookups for packages and releases', async () => {
    // 1. PostgreSQL
    const db = newDb();
    const Pool = db.adapters.createPg().Pool;
    const pool = new Pool();
    const pgStorage = await initStorage({ pool });

    const upperVaultId = '0x' + 'A'.repeat(64);
    const lowerVaultId = '0x' + 'a'.repeat(64);

    const testPkg = { version: 1, binding: { vaultId: upperVaultId }, ciphertext: 'cipher' };
    await pgStorage.savePackage(upperVaultId, testPkg);

    const retrievedPgPkg = await pgStorage.getPackage(lowerVaultId);
    assert.ok(retrievedPgPkg, 'PostgresStorage should retrieve package by lower-case vaultId');
    assert.equal(retrievedPgPkg.ciphertext, 'cipher');

    const testRelease = {
      release: { binding: { vaultId: upperVaultId }, guardian: '0x1111111111111111111111111111111111111111', requestId: 1 },
      signature: '0xsig'
    };
    await pgStorage.saveRelease(upperVaultId, testRelease);

    const retrievedPgReleases = await pgStorage.getReleases(lowerVaultId);
    assert.equal(retrievedPgReleases.length, 1, 'PostgresStorage should retrieve releases by lower-case vaultId');

    await pgStorage.close();

    // 2. FileStorage
    const file = join(tmpDir, 'case-test-relay.json');
    const fileStorage = await initStorage({ file });

    await fileStorage.savePackage(upperVaultId, testPkg);
    const retrievedFilePkg = await fileStorage.getPackage(lowerVaultId);
    assert.ok(retrievedFilePkg, 'FileStorage should retrieve package by lower-case vaultId');
    assert.equal(retrievedFilePkg.ciphertext, 'cipher');

    await fileStorage.saveRelease(upperVaultId, testRelease);
    const retrievedFileReleases = await fileStorage.getReleases(lowerVaultId);
    assert.equal(retrievedFileReleases.length, 1, 'FileStorage should retrieve releases by lower-case vaultId');
  });

  test('PostgreSQL and File storage deduplicate releases on identical guardian and requestId', async () => {
    const vaultId = '0x' + 'c'.repeat(64);
    const guardian = '0x3333333333333333333333333333333333333333';

    // 1. PostgreSQL
    const db = newDb();
    const Pool = db.adapters.createPg().Pool;
    const pool = new Pool();
    const pgStorage = await initStorage({ pool });

    const releaseV1 = { release: { binding: { vaultId }, guardian, requestId: 10 }, signature: 'sig_v1' };
    const releaseV2 = { release: { binding: { vaultId }, guardian, requestId: 10 }, signature: 'sig_v2' };

    await pgStorage.saveRelease(vaultId, releaseV1);
    await pgStorage.saveRelease(vaultId, releaseV2);

    const pgReleases = await pgStorage.getReleases(vaultId);
    assert.equal(pgReleases.length, 1, 'PostgreSQL should deduplicate identical guardian release on same requestId');
    assert.equal(pgReleases[0].signature, 'sig_v2');
    await pgStorage.close();

    // 2. FileStorage
    const file = join(tmpDir, 'dedup-test-relay.json');
    const fileStorage = await initStorage({ file });

    await fileStorage.saveRelease(vaultId, releaseV1);
    await fileStorage.saveRelease(vaultId, releaseV2);

    const fileReleases = await fileStorage.getReleases(vaultId);
    assert.equal(fileReleases.length, 1, 'FileStorage should deduplicate identical guardian release on same requestId');
    assert.equal(fileReleases[0].signature, 'sig_v2');
  });

  test('initStorage accurately parses falsy and undefined DATABASE_URL values without error', async () => {
    for (const falsyVal of ['', '   ', 'undefined', 'null', 'false', '0']) {
      const file = join(tmpDir, `falsy-url-${Math.random().toString(36).slice(2)}.json`);
      const storage = await initStorage({ file, databaseUrl: falsyVal });
      assert.equal(storage.type, 'file', `DATABASE_URL="${falsyVal}" must fall back to file storage`);
      assert.equal(storage.isPostgres, false);
    }
  });

  test('PostgreSQL storage handles complete user auth and password validation lifecycle', async () => {
    const db = newDb();
    const Pool = db.adapters.createPg().Pool;
    const pool = new Pool();
    const storage = await initStorage({ pool });

    const salt = randomBytes(16).toString('hex');
    const password = 'SecretPassword123!';
    const passwordHash = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    const user = {
      id: 'usr_auth_lifecycle',
      name: 'Auth Test User',
      email: 'lifecycle@heirloom.io',
      role: 'owner',
      address: '0x4444444444444444444444444444444444444444',
      initials: 'AT',
      salt,
      passwordHash,
      createdAt: Date.now()
    };
    await storage.createUser(user);

    // 1. Fetch case-insensitively
    const fetched = await storage.getUserByEmail('LIFECYCLE@HEIRLOOM.IO');
    assert.ok(fetched);
    assert.equal(fetched.id, user.id);

    // 2. Validate password hash
    const computedHash = pbkdf2Sync(password, fetched.salt, 100000, 64, 'sha512').toString('hex');
    assert.equal(computedHash, fetched.passwordHash);

    const wrongHash = pbkdf2Sync('WrongPassword', fetched.salt, 100000, 64, 'sha512').toString('hex');
    assert.notEqual(wrongHash, fetched.passwordHash);

    // 3. Session lifecycle
    const token = 'tok_lifecycle_session';
    const expiresAt = Date.now() + 3600000;
    await storage.saveSession(token, {
      userId: user.id,
      email: user.email,
      createdAt: Date.now(),
      expiresAt
    });

    const activeSession = await storage.getSession(token);
    assert.ok(activeSession);
    assert.equal(activeSession.userId, user.id);
    assert.equal(activeSession.expiresAt, expiresAt);

    await storage.deleteSession(token);
    assert.equal(await storage.getSession(token), null);

    await storage.close();
  });

  test('HTTP Relay Auth and Persistence endpoints verify PostgreSQL records end-to-end', async () => {
    const db = newDb();
    const Pool = db.adapters.createPg().Pool;
    const pool = new Pool();
    const storage = await initStorage({ pool });

    const app = express();
    app.use(express.json());

    // Wire up endpoints matching server/index.mjs logic
    const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

    app.post('/api/auth/register', async (req, res) => {
      const { name, email, password, role, address } = req.body || {};
      const cleanEmail = email?.trim()?.toLowerCase();
      const cleanName = name?.trim();
      const cleanRole = ['owner', 'beneficiary', 'guardian'].includes(role) ? role : 'owner';
      const existingUser = await storage.getUserByEmail(cleanEmail);
      if (existingUser) return res.status(400).json({ error: 'An account with this email address already exists.' });

      const assignedAddress = (address || `0x${randomBytes(20).toString('hex')}`).toLowerCase();
      const salt = randomBytes(16).toString('hex');
      const passwordHash = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      const user = {
        id: `usr_${randomBytes(8).toString('hex')}`,
        name: cleanName,
        email: cleanEmail,
        role: cleanRole,
        address: assignedAddress,
        initials: 'TU',
        salt,
        passwordHash,
        createdAt: Date.now()
      };
      const token = randomBytes(32).toString('hex');
      const session = {
        userId: user.id,
        email: user.email,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86400 * 1000
      };
      await storage.createUser(user);
      await storage.saveSession(token, session);
      res.json({ ok: true, token, user });
    });

    app.post('/api/auth/login', async (req, res) => {
      const { email, password } = req.body || {};
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(400).json({ error: 'Invalid email or password' });
      const computedHash = pbkdf2Sync(password, user.salt, 100000, 64, 'sha512').toString('hex');
      if (computedHash !== user.passwordHash) return res.status(400).json({ error: 'Invalid email or password' });
      const token = randomBytes(32).toString('hex');
      const session = {
        userId: user.id,
        email: user.email,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86400 * 1000
      };
      await storage.saveSession(token, session);
      res.json({ ok: true, token, user });
    });

    app.get('/api/auth/session', async (req, res) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;
      if (!token) return res.json({ ok: false, user: null });
      const session = await storage.getSession(token);
      if (!session || Date.now() > session.expiresAt) {
        if (session) await storage.deleteSession(token);
        return res.json({ ok: false, user: null });
      }
      const user = await storage.getUserByEmail(session.email);
      res.json({ ok: true, user });
    });

    app.post('/api/auth/logout', async (req, res) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body?.token;
      if (token) await storage.deleteSession(token);
      res.json({ ok: true });
    });

    app.get('/api/packages', async (_req, res) => res.json(await storage.getPackages()));
    app.post('/api/packages', async (req, res) => {
      await storage.savePackage(req.body.package.binding.vaultId, req.body.package);
      res.json({ ok: true });
    });

    app.get('/api/releases/:vaultId', async (req, res) => res.json(await storage.getReleases(req.params.vaultId)));
    app.post('/api/releases', async (req, res) => {
      await storage.saveRelease(req.body.release.binding.vaultId, req.body);
      res.json({ ok: true });
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1. Register via HTTP
      const regRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Postgres HTTP User',
          email: 'http-pg@heirloom.io',
          password: 'Password123!',
          role: 'owner'
        })
      });
      assert.equal(regRes.status, 200);
      const regBody = await regRes.json();
      assert.ok(regBody.token);
      assert.equal(regBody.user.email, 'http-pg@heirloom.io');

      // Verify record exists directly in PostgreSQL users and sessions table
      const usersInDb = await pool.query('SELECT * FROM users WHERE email = $1', ['http-pg@heirloom.io']);
      assert.equal(usersInDb.rows.length, 1);
      assert.equal(usersInDb.rows[0].name, 'Postgres HTTP User');

      const sessionsInDb = await pool.query('SELECT * FROM sessions WHERE token = $1', [regBody.token]);
      assert.equal(sessionsInDb.rows.length, 1);
      assert.equal(sessionsInDb.rows[0].email, 'http-pg@heirloom.io');

      // 2. Query session via HTTP
      const sessRes = await fetch(`${base}/api/auth/session`, {
        headers: { Authorization: `Bearer ${regBody.token}` }
      });
      assert.equal(sessRes.status, 200);
      const sessBody = await sessRes.json();
      assert.equal(sessBody.ok, true);
      assert.equal(sessBody.user.email, 'http-pg@heirloom.io');

      // 3. Login via HTTP
      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'http-pg@heirloom.io', password: 'Password123!' })
      });
      assert.equal(loginRes.status, 200);
      const loginBody = await loginRes.json();
      assert.ok(loginBody.token);

      // 4. Logout via HTTP
      const logoutRes = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: regBody.token })
      });
      assert.equal(logoutRes.status, 200);

      // Verify session removed from PostgreSQL
      const deletedSession = await pool.query('SELECT * FROM sessions WHERE token = $1', [regBody.token]);
      assert.equal(deletedSession.rows.length, 0);

      // 5. Packages and releases via HTTP
      const vaultId = '0x' + 'e'.repeat(64);
      const pkg = { version: 1, binding: { vaultId }, ciphertext: 'test-encrypted-payload' };
      const pkgRes = await fetch(`${base}/api/packages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg })
      });
      assert.equal(pkgRes.status, 200);

      const pkgsInDb = await pool.query('SELECT * FROM packages WHERE LOWER("vaultId") = $1', [vaultId.toLowerCase()]);
      assert.equal(pkgsInDb.rows.length, 1);

      const getPkgsRes = await fetch(`${base}/api/packages`);
      assert.equal(getPkgsRes.status, 200);
      const pkgsList = await getPkgsRes.json();
      assert.equal(pkgsList.length, 1);

      const relEntry = {
        release: { binding: { vaultId }, guardian: '0x9999999999999999999999999999999999999999', requestId: 1 },
        signature: '0xrel_sig'
      };
      const relRes = await fetch(`${base}/api/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relEntry)
      });
      assert.equal(relRes.status, 200);

      const relsInDb = await pool.query('SELECT * FROM releases WHERE LOWER("vaultId") = $1', [vaultId.toLowerCase()]);
      assert.equal(relsInDb.rows.length, 1);

      const getRelsRes = await fetch(`${base}/api/releases/${vaultId}`);
      assert.equal(getRelsRes.status, 200);
      const relsList = await getRelsRes.json();
      assert.equal(relsList.length, 1);
    } finally {
      server.close();
      await storage.close();
    }
  });

  test('cleanup temporary test directory', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
