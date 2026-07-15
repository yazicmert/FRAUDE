import { invokePlatform, isDesktopRuntime } from '../api/platformClient';
import type {
  InstalledModule,
  ModuleActivationResult,
  ModuleRelease,
  StagingRecord,
} from './types';
import { readStagedModuleBundle, runBundleTestsInSandbox } from './sandboxRuntime';
import { validateBundleCapabilities } from './capabilityBroker';

const CACHE_NAME = 'fraude-module-staging-v1';
const WEB_SNAPSHOT_KEY = 'fraude-module-snapshots-v1';

interface WebSnapshot {
  id: string;
  module: InstalledModule;
  createdAt: string;
}

function stagedArtifactRequest(hash: string) {
  return new Request(`https://staging.fraude.invalid/${hash}`);
}

function readWebSnapshots(): WebSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(WEB_SNAPSHOT_KEY) ?? '[]') as WebSnapshot[];
  } catch {
    return [];
  }
}

function saveWebSnapshot(snapshot: WebSnapshot) {
  const snapshots = readWebSnapshots().filter((item) => item.id !== snapshot.id);
  localStorage.setItem(WEB_SNAPSHOT_KEY, JSON.stringify([snapshot, ...snapshots].slice(0, 25)));
}

export async function activateStagedModule(
  release: ModuleRelease,
  record: StagingRecord,
  installed: InstalledModule,
): Promise<ModuleActivationResult> {
  const artifact = release.manifest.artifact;
  if (!artifact || record.status !== 'staged') throw new Error('Module is not ready for activation.');
  const bundle = await readStagedModuleBundle(artifact.sha256, release.manifest.id, release.manifest.version);
  validateBundleCapabilities(bundle, release.manifest);
  const sandboxReport = await runBundleTestsInSandbox(bundle);
  if (!sandboxReport.valid) throw new Error(`Sandbox tests failed: ${sandboxReport.errors.join(', ')}`);

  if (isDesktopRuntime()) {
    return invokePlatform<ModuleActivationResult>('activate_module_release', {
      request: {
        moduleId: release.manifest.id,
        version: release.manifest.version,
        artifactUrl: artifact.url,
        artifactHash: artifact.sha256,
        manifestJson: JSON.stringify(release.manifest),
        previousModuleJson: JSON.stringify(installed),
      },
    });
  }

  const cache = await caches.open(CACHE_NAME);
  const staged = await cache.match(stagedArtifactRequest(artifact.sha256));
  if (!staged) throw new Error('Verified staging artifact is missing.');

  const snapshotId = `${release.manifest.id}:${Date.now()}`;
  saveWebSnapshot({ id: snapshotId, module: installed, createdAt: new Date().toISOString() });
  return {
    moduleId: release.manifest.id,
    version: release.manifest.version,
    artifactHash: artifact.sha256,
    snapshotId,
    runtime: 'web',
  };
}

export async function rollbackModuleActivation(
  moduleId: InstalledModule['id'],
  snapshotId: string,
): Promise<InstalledModule> {
  if (isDesktopRuntime()) {
    const result = await invokePlatform<{ module: InstalledModule }>('rollback_module_release', {
      request: { moduleId, snapshotId },
    });
    return result.module;
  }

  const snapshot = readWebSnapshots().find((item) => item.id === snapshotId && item.module.id === moduleId);
  if (!snapshot) throw new Error('Rollback snapshot was not found.');
  return snapshot.module;
}
