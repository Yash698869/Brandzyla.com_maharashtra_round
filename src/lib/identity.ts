import { createIdentity } from './crypto';
import { publicKeyHash } from './crypto';
import { createBackedIdentity, restoreBackedIdentity, type BackupContext, type IdentityBackup } from './identity-backup';
import { canonical } from '../../shared/protocol.mjs';
import type { Identity } from './types';
import type { PendingRegistration } from './registration';

interface CustodyRecord { identity: Identity; backup?: IdentityBackup; verified: boolean }
const keyFor = (namespace: string, address: string) => `${namespace}:${address.toLowerCase()}`;
function recordOf(value: Identity | CustodyRecord | undefined): CustodyRecord | undefined {
  if (!value) return undefined;
  return 'identity' in value ? value : { identity: value, verified: false };
}

let dbPromise: Promise<IDBDatabase>;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('heirloom-custody-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('identities');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
export async function custodyRecord(namespace: string, address: string): Promise<CustodyRecord | undefined> {
  const db = await database(); return new Promise((resolve, reject) => {
    const request = db.transaction('identities', 'readonly').objectStore('identities').get(keyFor(namespace, address));
    request.onsuccess = () => resolve(recordOf(request.result)); request.onerror = () => reject(request.error);
  });
}
export async function storedIdentity(namespace: string, address: string): Promise<Identity | undefined> { return (await custodyRecord(namespace, address))?.identity; }
export async function obtainIdentity(namespace: string, address: string): Promise<Identity> {
  const previous = await storedIdentity(namespace, address); if (previous) return previous;
  const identity = await createIdentity(); const db = await database();
  return new Promise<Identity>((resolve, reject) => {
    const tx = db.transaction('identities', 'readwrite');
    const store = tx.objectStore('identities'), key = keyFor(namespace, address);
    let retained = identity;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) retained = recordOf(request.result)!.identity;
      else store.add(identity, key);
    };
    tx.oncomplete = () => resolve(retained);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

export async function createBackedStoredIdentity(namespace: string, address: string, passphrase: string, context: BackupContext): Promise<IdentityBackup> {
  if (context.address.toLowerCase() !== address.toLowerCase()) throw new Error('Backup wallet does not match the active account');
  const { identity, backup } = await createBackedIdentity(context, passphrase);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('identities', 'readwrite'), store = tx.objectStore('identities');
    let failure: Error | undefined;
    const request = store.get(keyFor(namespace, address));
    request.onsuccess = () => {
      if (request.result) { failure = new Error('An encryption identity already exists for this wallet'); tx.abort(); }
      else store.add({ identity, backup, verified: false } satisfies CustodyRecord, keyFor(namespace, address));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
  });
  return backup;
}

export async function verifyStoredBackup(namespace: string, address: string, backup: unknown, passphrase: string, context: BackupContext): Promise<void> {
  const restored = await restoreBackedIdentity(backup, passphrase, context);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('identities', 'readwrite'), store = tx.objectStore('identities');
    let failure: Error | undefined;
    const request = store.get(keyFor(namespace, address));
    request.onsuccess = () => {
      const current = recordOf(request.result);
      if (!current?.backup || canonical(current.backup) !== canonical(backup) || publicKeyHash(current.identity.publicKey) !== publicKeyHash(restored.publicKey)) {
        failure = new Error('Downloaded backup does not match this browser identity'); tx.abort(); return;
      }
      store.put({ ...current, verified: true } satisfies CustodyRecord, keyFor(namespace, address));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}

export async function restoreStoredIdentity(namespace: string, address: string, backup: unknown, passphrase: string, context: BackupContext, enrolledKeyHash?: string): Promise<Identity> {
  if (context.address.toLowerCase() !== address.toLowerCase()) throw new Error('Backup wallet does not match the active account');
  const identity = await restoreBackedIdentity(backup, passphrase, context, enrolledKeyHash);
  const db = await database();
  return new Promise<Identity>((resolve, reject) => {
    const tx = db.transaction('identities', 'readwrite'), store = tx.objectStore('identities');
    let retained = identity, failure: Error | undefined;
    const request = store.get(keyFor(namespace, address));
    request.onsuccess = () => {
      const current = recordOf(request.result);
      if (current) {
        if (publicKeyHash(current.identity.publicKey) !== publicKeyHash(identity.publicKey)) { failure = new Error('A different browser identity already exists for this wallet'); tx.abort(); }
        else retained = current.identity;
      } else store.add({ identity, backup: backup as IdentityBackup, verified: true } satisfies CustodyRecord, keyFor(namespace, address));
    };
    tx.oncomplete = () => resolve(retained);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}

let pendingDB: Promise<IDBDatabase>;
function pendingDatabase() {
  if (!pendingDB) pendingDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('heirloom-pending-registrations-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); return pendingDB;
}
export async function persistPending(namespace: string, entry: PendingRegistration) {
  const db = await pendingDatabase(); await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite'); tx.objectStore('pending').put({ ...entry, namespace }, `${namespace}:${entry.package.binding.vaultId}`);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export async function pendingRegistrations(namespace: string): Promise<PendingRegistration[]> {
  const db = await pendingDatabase(); return new Promise((resolve, reject) => {
    const request = db.transaction('pending', 'readonly').objectStore('pending').getAll();
    request.onsuccess = () => resolve(request.result.filter(e => e.namespace === namespace)); request.onerror = () => reject(request.error);
  });
}
export async function clearPending(namespace: string, id: string) {
  const db = await pendingDatabase(); await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite'); tx.objectStore('pending').delete(`${namespace}:${id}`);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
