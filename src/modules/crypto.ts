import type { ModuleRelease, RegistryTrustKey, ReleaseVerification } from './types';

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

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function releaseSigningPayload(release: ModuleRelease): string {
  const { provenance: _provenance, ...unsignedRelease } = release;
  return JSON.stringify(stableValue(unsignedRelease));
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export async function verifyReleaseSignature(
  release: ModuleRelease,
  trustKeys: RegistryTrustKey[],
): Promise<ReleaseVerification> {
  const key = trustKeys.find((candidate) => candidate.id === release.provenance.keyId);
  if (!key) {
    return { verified: false, keyId: release.provenance.keyId, reason: 'unknown-signing-key' };
  }
  if (key.revokedAt) {
    return { verified: false, keyId: key.id, reason: 'revoked-signing-key' };
  }
  if (!key.channels.includes(release.manifest.channel)) {
    return { verified: false, keyId: key.id, reason: 'channel-not-authorized' };
  }
  if (key.algorithm !== 'Ed25519' || release.provenance.algorithm !== 'Ed25519') {
    return { verified: false, keyId: key.id, reason: 'unsupported-signature-algorithm' };
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      decodeBase64(key.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      decodeBase64(release.provenance.signature),
      new TextEncoder().encode(releaseSigningPayload(release)),
    );
    return { verified, keyId: key.id, reason: verified ? undefined : 'invalid-signature' };
  } catch {
    return { verified: false, keyId: key.id, reason: 'signature-verification-failed' };
  }
}
