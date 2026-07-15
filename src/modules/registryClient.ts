import type { ModuleChannel, ModuleRelease, ModuleTarget, RegistryTrustKey } from './types';

interface LatestReleasesResponse {
  releases: ModuleRelease[];
}

interface TrustKeysResponse {
  keys: RegistryTrustKey[];
}

export function getRegistryUrl(): string | null {
  const configured = import.meta.env.VITE_FRAUDE_REGISTRY_URL?.trim()
    || import.meta.env.VITE_FRAUDE_API_URL?.trim();
  return configured ? configured.replace(/\/$/, '') : null;
}

async function registryGet<T>(path: string): Promise<T> {
  const baseUrl = getRegistryUrl();
  if (!baseUrl) throw new Error('FRAUDE Registry is not configured.');

  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function getLatestReleases(
  target: ModuleTarget,
  coreVersion: string,
  channel: ModuleChannel = 'official',
): Promise<ModuleRelease[]> {
  const params = new URLSearchParams({ target, core: coreVersion, channel });
  const response = await registryGet<LatestReleasesResponse>(`/v1/channels/${channel}/latest?${params}`);
  if (!Array.isArray(response.releases)) throw new Error('Registry returned an invalid release list.');
  return response.releases;
}

export async function getTrustKeys(): Promise<RegistryTrustKey[]> {
  const response = await registryGet<TrustKeysResponse>('/v1/trust/keys');
  if (!Array.isArray(response.keys)) throw new Error('Registry returned an invalid trust store.');
  const configured = import.meta.env.VITE_FRAUDE_TRUST_KEYS?.trim();
  const registryUrl = getRegistryUrl();
  const isLocalDevelopment = registryUrl
    ? ['127.0.0.1', 'localhost'].includes(new URL(registryUrl).hostname)
    : false;
  if (!configured) {
    if (isLocalDevelopment) return response.keys;
    throw new Error('Remote registry requires pinned FRAUDE trust keys.');
  }

  let pinned: RegistryTrustKey[];
  try {
    pinned = JSON.parse(configured) as RegistryTrustKey[];
  } catch {
    throw new Error('VITE_FRAUDE_TRUST_KEYS is not valid JSON.');
  }
  if (!Array.isArray(pinned) || pinned.length === 0) {
    throw new Error('At least one pinned FRAUDE trust key is required.');
  }
  return response.keys.filter((remote) => pinned.some((trusted) => (
    trusted.id === remote.id
      && trusted.algorithm === remote.algorithm
      && trusted.publicKey === remote.publicKey
      && !trusted.revokedAt
  )));
}
