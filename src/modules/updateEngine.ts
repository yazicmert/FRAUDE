import { CORE_VERSION } from './catalog';
import type {
  ConflictBundle,
  InstalledModule,
  ModulePermission,
  ModuleRelease,
  ModuleUpdatePlan,
} from './types';

function parseVersion(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  return next.some((value, index) => value > installed[index]
    && next.slice(0, index).every((part, partIndex) => part === installed[partIndex]));
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function satisfiesCompatibility(version: string, range: string): boolean {
  return range.split(/\s+/).filter(Boolean).every((constraint) => {
    const match = constraint.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match) return false;
    const [, operator = '=', target] = match;
    const comparison = compareVersions(version, target);
    if (operator === '>=') return comparison >= 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<') return comparison < 0;
    return comparison === 0;
  });
}

export function planModuleUpdate(
  installed: InstalledModule,
  currentPermissions: ModulePermission[],
  release: ModuleRelease,
  coreVersion = CORE_VERSION,
): ModuleUpdatePlan {
  const hasLocalOverlay = Boolean(installed.localOverlayHash);
  const baseMatches = release.baseArtifactHash === installed.artifactHash;
  const conflicts = hasLocalOverlay
    ? release.changes.filter((change) => change.kind !== 'add')
    : [];
  const addedPermissions = release.manifest.permissions.filter(
    (permission) => !currentPermissions.includes(permission),
  );

  return {
    moduleId: release.manifest.id,
    fromVersion: installed.version,
    toVersion: release.manifest.version,
    compatible: baseMatches
      && isNewerVersion(release.manifest.version, installed.version)
      && satisfiesCompatibility(coreVersion, release.manifest.compatibility.fraude),
    baseMatches,
    addedPermissions,
    changes: release.changes,
    conflicts,
    requiresApproval: release.changes.length > 0 || addedPermissions.length > 0,
  };
}

export function createConflictPrompt(plan: ModuleUpdatePlan, language: 'tr' | 'en'): string {
  const paths = plan.conflicts.map((change) => `- ${change.path}`).join('\n');
  if (language === 'en') {
    return `Resolve a FRAUDE module update conflict.\nModule: ${plan.moduleId}\nVersion: ${plan.fromVersion} -> ${plan.toVersion}\nConflicting files:\n${paths}\nPreserve local customizations, incorporate upstream behavior, do not add permissions, and return a unified diff only.`;
  }
  return `FRAUDE modül güncelleme çakışmasını çöz.\nModül: ${plan.moduleId}\nSürüm: ${plan.fromVersion} -> ${plan.toVersion}\nÇakışan dosyalar:\n${paths}\nYerel özelleştirmeleri koru, üst sürüm davranışını ekle, yeni izin ekleme ve yalnızca unified diff döndür.`;
}

export function createConflictBundle(
  installed: InstalledModule,
  release: ModuleRelease,
  plan: ModuleUpdatePlan,
): ConflictBundle {
  const baseMismatch = installed.artifactHash !== release.baseArtifactHash;
  const files = (plan.conflicts.length > 0 ? plan.conflicts : baseMismatch ? plan.changes : [])
    .map((change) => ({
      ...change,
      reason: baseMismatch ? 'base-mismatch' as const : 'local-overlay-modified' as const,
    }));
  return {
    schemaVersion: 1,
    moduleId: plan.moduleId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    installedArtifactHash: installed.artifactHash,
    incomingBaseArtifactHash: release.baseArtifactHash,
    localOverlayHash: installed.localOverlayHash,
    files,
    constraints: {
      preserveLocalChanges: true,
      rejectNewPermissions: true,
      output: 'unified-diff',
    },
  };
}

export function createConflictFixPrompt(
  bundle: ConflictBundle,
  language: 'tr' | 'en',
): string {
  const heading = language === 'tr'
    ? 'Aşağıdaki FRAUDE modül güncelleme çakışmasını çöz.'
    : 'Resolve the following FRAUDE module update conflict.';
  const rules = language === 'tr'
    ? 'Yerel davranışı koru, upstream değişikliklerini birleştir, yeni izin ekleme. Yalnızca uygulanabilir unified diff döndür; açıklama veya komut döndürme.'
    : 'Preserve local behavior, merge upstream changes, and add no permissions. Return only an applicable unified diff; do not return explanations or commands.';
  return `${heading}\n\nCONFLICT_BUNDLE_JSON\n${JSON.stringify(bundle, null, 2)}\n\nRULES\n${rules}`;
}
