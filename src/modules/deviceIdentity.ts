import { sha256Hex } from './crypto';

const DB_NAME = 'fraude-device-identity-v1';
const STORE_NAME = 'keys';
const KEY_NAME = 'contribution-signing-key';

export interface StoredIdentity {
  id: string;
  algorithm: 'Ed25519';
  publicKey: string;
  privateKey: CryptoKey;
  createdAt: string;
}

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Device identity database failed.'));
  });
}

function readIdentity(db: IDBDatabase): Promise<StoredIdentity | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY_NAME);
    request.onsuccess = () => resolve(request.result as StoredIdentity | undefined);
    request.onerror = () => reject(request.error ?? new Error('Device identity read failed.'));
  });
}

function writeIdentity(db: IDBDatabase, identity: StoredIdentity): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(identity, KEY_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Device identity write failed.'));
  });
}

function base64Url(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function getOrCreateDeviceIdentity(): Promise<StoredIdentity> {
  const db = await openIdentityDb();
  try {
    const existing = await readIdentity(db);
    if (existing) return existing;

    const generated = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicBytes = await crypto.subtle.exportKey('raw', generated.publicKey);
    const privateBytes = await crypto.subtle.exportKey('pkcs8', generated.privateKey);
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateBytes,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    const fingerprint = await sha256Hex(publicBytes);
    const identity: StoredIdentity = {
      id: `ed25519:${fingerprint}`,
      algorithm: 'Ed25519',
      publicKey: base64Url(publicBytes),
      privateKey,
      createdAt: new Date().toISOString(),
    };
    await writeIdentity(db, identity);
    return identity;
  } finally {
    db.close();
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function contributionSigningPayload(value: Record<string, unknown>): string {
  return JSON.stringify(stableValue(value));
}

export async function signContributionPayload(
  unsignedContribution: Record<string, unknown>,
): Promise<{ algorithm: 'Ed25519'; keyId: string; publicKey: string; signature: string }> {
  const identity = await getOrCreateDeviceIdentity();
  const author = {
    algorithm: identity.algorithm,
    keyId: identity.id,
    publicKey: identity.publicKey,
  };
  const payload = contributionSigningPayload({ ...unsignedContribution, provenance: author });
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    identity.privateKey,
    new TextEncoder().encode(payload),
  );
  return { ...author, signature: base64Url(signature) };
}
