import type { IdentityBackup } from './identity-backup';
import { keyHash } from '../../shared/protocol.mjs';

export type CustodyStep = 'create' | 'verify' | 'restore' | 'enroll' | 'ready' | 'legacy';
export type CustodyAction = 'create' | 'release' | 'decrypt' | 'checkIn' | 'requestRecovery' | 'approveRecovery' | 'finalizeRecovery';

export function needsCustodyKey(action: CustodyAction): boolean {
  return action === 'create' || action === 'release' || action === 'decrypt';
}

export function custodyStep(enrolled: boolean, record?: { backup?: IdentityBackup; verified: boolean }): CustodyStep {
  if (!record) return enrolled ? 'restore' : 'create';
  if (!record.backup) return 'legacy';
  if (!record.verified) return 'verify';
  return enrolled ? 'ready' : 'enroll';
}

export function enrollmentMatches(localPublicKey: JsonWebKey, enrolledPublicKey: JsonWebKey): boolean {
  return keyHash(localPublicKey) === keyHash(enrolledPublicKey);
}
