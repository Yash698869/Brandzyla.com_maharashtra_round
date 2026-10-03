import { createIdentity, packageCommitment, publicKeyHash } from './crypto';
import type { Identity, IdentityRecord } from './types';
import type { PendingRegistration } from './registration';

let dbPromise: Promise<IDBDatabase>;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('heirloom-custody-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('identities');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
export async function storedIdentity(namespace: string, address: string): Promise<Identity | undefined> {
  const db = await database(); return new Promise((resolve, reject) => {
    const request = db.transaction("identities", "readonly").objectStore("identities").get(`${namespace}:${address.toLowerCase()}`);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export function walletCustodyStatus(enrolled: IdentityRecord | undefined, local: Identity | undefined): 'enroll' | 'ready' | 'wallet-only' | 'mismatch' {
  if (!enrolled) return 'enroll';
  if (!local) return 'wallet-only';
  return publicKeyHash(enrolled.publicKey) === publicKeyHash(local.publicKey) ? 'ready' : 'mismatch';
}
export async function obtainIdentity(namespace: string, address: string): Promise<Identity> {
  const previous = await storedIdentity(namespace, address); if (previous) return previous;
  const identity = await createIdentity(); const db = await database();
  return new Promise<Identity>((resolve, reject) => {
    const tx = db.transaction('identities', 'readwrite');
    const store = tx.objectStore('identities'), key = `${namespace}:${address.toLowerCase()}`;
    let retained = identity;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) retained = request.result;
      else store.add(identity, key);
    };
    tx.oncomplete = () => resolve(retained);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
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
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending'), key = `${namespace}:${entry.package.binding.vaultId}`;
    let conflict: Error | undefined;
    const request = store.get(key);
    request.onsuccess = () => {
      const previous = request.result as (PendingRegistration & { namespace: string }) | undefined;
      if (previous && packageCommitment(previous.package) !== packageCommitment(entry.package)) {
        conflict = new Error('A different encrypted package is already preserved for this vault');
        tx.abort(); return;
      }
      store.put({ ...entry, transactionHash: entry.transactionHash ?? previous?.transactionHash, namespace }, key);
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(conflict ?? tx.error); tx.onabort = () => reject(conflict ?? tx.error);
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
