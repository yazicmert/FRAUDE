import { sha256Hex } from './crypto';
import type { ModuleRelease, StagingRecord, StagingStatus } from './types';

const STORAGE_KEY = 'fraude-staging-records-v1';
const CACHE_NAME = 'fraude-module-staging-v1';

const allowedTransitions: Record<StagingStatus, StagingStatus[]> = {
  discovered: ['verified', 'failed'],
  verified: ['approved', 'failed'],
  approved: ['staged', 'failed'],
  staged: ['activated', 'rolled_back', 'failed'],
  activated: ['rolled_back'],
  rolled_back: [],
  failed: [],
};

export function readStagingRecords(): StagingRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StagingRecord[];
  } catch {
    return [];
  }
}

function saveRecord(record: StagingRecord): StagingRecord {
  const records = readStagingRecords().filter((item) => item.id !== record.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...records].slice(0, 50)));
  return record;
}

export function createApprovedStagingRecord(release: ModuleRelease, fromVersion: string): StagingRecord {
  if (!release.manifest.artifact) throw new Error('Release has no artifact.');
  const now = new Date().toISOString();
  return saveRecord({
    id: `${release.manifest.id}:${release.manifest.version}:${now}`,
    moduleId: release.manifest.id,
    fromVersion,
    toVersion: release.manifest.version,
    artifactHash: release.manifest.artifact.sha256,
    status: 'approved',
    createdAt: now,
    updatedAt: now,
  });
}

export function transitionStagingRecord(
  record: StagingRecord,
  status: StagingStatus,
  error?: string,
): StagingRecord {
  if (!allowedTransitions[record.status].includes(status)) {
    throw new Error(`Invalid staging transition: ${record.status} -> ${status}`);
  }
  return saveRecord({ ...record, status, error, updatedAt: new Date().toISOString() });
}

export function attachSnapshotToStagingRecord(
  record: StagingRecord,
  snapshotId: string | undefined,
): StagingRecord {
  const next = transitionStagingRecord(record, 'activated');
  return saveRecord({ ...next, snapshotId, updatedAt: new Date().toISOString() });
}

export async function stageReleaseArtifact(
  release: ModuleRelease,
  record: StagingRecord,
): Promise<StagingRecord> {
  const artifact = release.manifest.artifact;
  if (!artifact) throw new Error('Release has no downloadable artifact.');
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error('Artifact SHA-256 is invalid.');

  try {
    const response = await fetch(artifact.url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
    const bytes = await response.arrayBuffer();
    const actualHash = await sha256Hex(bytes);
    if (actualHash.toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new Error('Artifact hash does not match the signed manifest.');
    }
    if (!('caches' in window)) throw new Error('This runtime has no secure staging cache.');
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      new Request(`https://staging.fraude.invalid/${artifact.sha256}`),
      new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    return transitionStagingRecord(record, 'staged');
  } catch (error) {
    return transitionStagingRecord(record, 'failed', String(error));
  }
}
