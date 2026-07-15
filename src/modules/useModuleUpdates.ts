import { useState } from 'react';
import { activateStagedModule, rollbackModuleActivation } from './activation';
import { CORE_VERSION, getModuleManifest } from './catalog';
import { verifyReleaseSignature } from './crypto';
import { getLatestReleases, getRegistryUrl, getTrustKeys } from './registryClient';
import {
  attachSnapshotToStagingRecord,
  createApprovedStagingRecord,
  stageReleaseArtifact,
  transitionStagingRecord,
} from './staging';
import { activateInstalledModule, restoreInstalledModule } from './storage';
import { isNewerVersion, planModuleUpdate } from './updateEngine';
import type {
  DeclarativeModuleBundle,
  InstalledModule,
  ModuleUpdateCandidate,
  StagingRecord,
} from './types';
import { getRuntimeTarget } from './platform';
import { getApprovedOverlay, readApprovedOverlayBundle } from './patchPipeline';
import { readStagedModuleBundle } from './sandboxRuntime';
import { executeCapabilityRequests } from './capabilityBroker';
import type { ModuleCapabilityResult } from './types';

export function useModuleUpdates(
  installedModules: InstalledModule[],
  onInstalledModulesChange: (modules: InstalledModule[]) => void,
) {
  const [candidates, setCandidates] = useState<ModuleUpdateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [staging, setStaging] = useState<StagingRecord | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [runtimeContributions, setRuntimeContributions] = useState<DeclarativeModuleBundle['contributions']>([]);
  const [capabilityResults, setCapabilityResults] = useState<ModuleCapabilityResult[]>([]);

  const checkForUpdates = async () => {
    setChecking(true);
    setError('');
    try {
      const [releases, trustKeys] = await Promise.all([
        getLatestReleases(getRuntimeTarget(), CORE_VERSION),
        getTrustKeys(),
      ]);
      const next = await Promise.all(releases.map(async (release) => {
        const installed = installedModules.find((item) => item.id === release.manifest.id);
        const currentManifest = getModuleManifest(release.manifest.id);
        if (!installed || !currentManifest) return null;
        if (!isNewerVersion(release.manifest.version, installed.version)) return null;
        const verification = await verifyReleaseSignature(release, trustKeys);
        const plan = planModuleUpdate(installed, currentManifest.permissions, release);
        return { installed, release, verification, plan } satisfies ModuleUpdateCandidate;
      }));
      setCandidates(next.filter((item): item is ModuleUpdateCandidate => item !== null));
      setLastCheckedAt(new Date().toISOString());
    } catch (reason) {
      setCandidates([]);
      setError(String(reason));
    } finally {
      setChecking(false);
    }
  };

  const stageCandidate = async (candidate: ModuleUpdateCandidate) => {
    if (!candidate.verification.verified || !candidate.plan.compatible) {
      throw new Error('Only verified and compatible releases can be staged.');
    }
    const record = createApprovedStagingRecord(candidate.release, candidate.plan.fromVersion);
    setStaging(record);
    const result = await stageReleaseArtifact(candidate.release, record);
    setStaging(result);
    return result;
  };

  const activateCandidate = async (candidate: ModuleUpdateCandidate) => {
    if (!staging || staging.moduleId !== candidate.release.manifest.id || staging.status !== 'staged') {
      throw new Error('A verified staged package is required.');
    }
    const approvedOverlay = getApprovedOverlay(candidate.release.manifest.id, candidate.release.manifest.version);
    if (candidate.plan.conflicts.length > 0 && !approvedOverlay) {
      throw new Error('Local conflicts must be resolved before activation.');
    }
    const installed = installedModules.find((item) => item.id === candidate.release.manifest.id);
    if (!installed) throw new Error('Installed module state was not found.');
    const result = await activateStagedModule(candidate.release, staging, installed);
    const runtimeBundle = approvedOverlay
      ? await readApprovedOverlayBundle(approvedOverlay.overlayHash)
      : await readStagedModuleBundle(
        candidate.release.manifest.artifact!.sha256,
        candidate.release.manifest.id,
        candidate.release.manifest.version,
      );
    const nextModules = activateInstalledModule(
      installedModules,
      result.moduleId,
      result.version,
      result.artifactHash,
      approvedOverlay?.overlayHash,
    );
    onInstalledModulesChange(nextModules);
    const activated = attachSnapshotToStagingRecord(staging, result.snapshotId);
    setStaging(activated);
    setRuntimeContributions(runtimeBundle.contributions);
    setCapabilityResults(await executeCapabilityRequests(runtimeBundle, candidate.release.manifest));
    return activated;
  };

  const rollbackCandidate = async () => {
    if (!staging || staging.status !== 'activated' || !staging.snapshotId) {
      throw new Error('An activated module snapshot is required.');
    }
    const restored = await rollbackModuleActivation(staging.moduleId, staging.snapshotId);
    const nextModules = restoreInstalledModule(installedModules, restored);
    onInstalledModulesChange(nextModules);
    const rolledBack = transitionStagingRecord(staging, 'rolled_back');
    setStaging(rolledBack);
    setRuntimeContributions([]);
    setCapabilityResults([]);
    return rolledBack;
  };

  return {
    candidates,
    checking,
    error,
    registryConfigured: Boolean(getRegistryUrl()),
    staging,
    lastCheckedAt,
    checkForUpdates,
    stageCandidate,
    activateCandidate,
    rollbackCandidate,
    runtimeContributions,
    capabilityResults,
  };
}
