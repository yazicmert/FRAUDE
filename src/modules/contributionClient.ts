import { getApprovedOverlay } from './patchPipeline';
import { getRegistryUrl } from './registryClient';
import type {
  ModuleContribution,
  ModuleContributionReceipt,
  ModuleUpdateCandidate,
} from './types';

export interface ReviewContribution extends ModuleContributionReceipt {
  contributorId: string;
  changedPaths: string[];
  testsPassed: number;
}
import { getOrCreateDeviceIdentity, signContributionPayload } from './deviceIdentity';

export async function createModuleContribution(candidate: ModuleUpdateCandidate): Promise<ModuleContribution> {
  const overlay = getApprovedOverlay(candidate.release.manifest.id, candidate.release.manifest.version);
  if (!overlay) throw new Error('An approved overlay is required before submission.');
  const identity = await getOrCreateDeviceIdentity();
  const unsigned = {
    schemaVersion: 1 as const,
    clientSubmissionId: crypto.randomUUID(),
    contributorId: identity.id,
    moduleId: candidate.release.manifest.id,
    baseVersion: candidate.plan.fromVersion,
    targetVersion: candidate.plan.toVersion,
    baseArtifactHash: candidate.release.baseArtifactHash,
    overlayHash: overlay.overlayHash,
    patch: overlay.patch,
    changedPaths: overlay.changedPaths,
    testsPassed: overlay.testsPassed,
    submittedAt: new Date().toISOString(),
  };
  const provenance = await signContributionPayload(unsigned);
  return { ...unsigned, contributorId: provenance.keyId, provenance };
}

export async function submitModuleContribution(
  candidate: ModuleUpdateCandidate,
): Promise<ModuleContributionReceipt> {
  const registry = getRegistryUrl();
  if (!registry) throw new Error('FRAUDE Registry is not configured.');
  const contribution = await createModuleContribution(candidate);
  const response = await fetch(`${registry}/v1/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(contribution),
  });
  const payload = await response.json() as { contribution?: ModuleContributionReceipt; error?: string };
  if (!response.ok || !payload.contribution) {
    throw new Error(payload.error ?? `Contribution submission failed (${response.status}).`);
  }
  return payload.contribution;
}

export async function getContributionReceipt(id: string): Promise<ModuleContributionReceipt> {
  const registry = getRegistryUrl();
  if (!registry) throw new Error('FRAUDE Registry is not configured.');
  const response = await fetch(`${registry}/v1/contributions/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  });
  const payload = await response.json() as { contribution?: ModuleContributionReceipt; error?: string };
  if (!response.ok || !payload.contribution) throw new Error(payload.error ?? 'Contribution was not found.');
  return payload.contribution;
}

export async function listReviewContributions(token: string): Promise<ReviewContribution[]> {
  const registry = getRegistryUrl();
  if (!registry) throw new Error('FRAUDE Registry is not configured.');
  const response = await fetch(`${registry}/v1/review/contributions?status=pending-review`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
  const payload = await response.json() as { contributions?: ReviewContribution[]; error?: string };
  if (!response.ok || !payload.contributions) throw new Error(payload.error ?? 'Review queue could not be loaded.');
  return payload.contributions;
}

export async function reviewContribution(
  token: string,
  id: string,
  status: 'accepted' | 'rejected',
  note: string,
): Promise<ModuleContributionReceipt> {
  const registry = getRegistryUrl();
  if (!registry) throw new Error('FRAUDE Registry is not configured.');
  const response = await fetch(`${registry}/v1/review/contributions/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    credentials: 'omit',
    body: JSON.stringify({ status, note }),
  });
  const payload = await response.json() as { contribution?: ModuleContributionReceipt; error?: string };
  if (!response.ok || !payload.contribution) throw new Error(payload.error ?? 'Review decision failed.');
  return payload.contribution;
}
