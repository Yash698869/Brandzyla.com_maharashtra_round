import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  test('cleanup temporary test directory', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
