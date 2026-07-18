import { moduleCatalog } from './catalog';
import type { InstalledModule, ModuleManifest } from './types';

const STORAGE_KEY = 'fraude-module-state-v1';

export function embeddedArtifactId(module: ModuleManifest): string {
  return `embedded:${module.id}@${module.version}`;
}

function defaults(): InstalledModule[] {
  const installedAt = new Date().toISOString();
  return moduleCatalog.map((module) => ({
    id: module.id,
    version: module.version,
    enabled: true,
    installedAt,
    artifactHash: module.artifact?.sha256 ?? embeddedArtifactId(module),
  }));
}

export function readInstalledModules(): InstalledModule[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults();

    const parsed = JSON.parse(stored) as InstalledModule[];
    const known = new Map(parsed.map((item) => [item.id, item]));
    const merged = moduleCatalog.map((module) => {
      const existing = known.get(module.id);
      return existing ? {
        ...existing,
        artifactHash: existing.artifactHash ?? module.artifact?.sha256 ?? embeddedArtifactId(module),
      } : {
        id: module.id,
        version: module.version,
        enabled: true,
        installedAt: new Date().toISOString(),
        artifactHash: module.artifact?.sha256 ?? embeddedArtifactId(module),
      };
    });
    // Hiçbir modülün açık olmadığı durum meşru bir yapılandırma değil, bozuk
    // kayıttır: çalışma alanı sekmesiz/menüsüz simsiyah kalır ve kullanıcı
    // Modül Merkezi'ne bile ulaşamaz. Varsayılana dönerek kendini onarır.
    return merged.some((module) => module.enabled) ? merged : defaults();
  } catch {
    return defaults();
  }
}

export function writeInstalledModules(modules: InstalledModule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modules));
}

export function activateInstalledModule(
  modules: InstalledModule[],
  id: ModuleManifest['id'],
  version: string,
  artifactHash: string,
  localOverlayHash?: string,
): InstalledModule[] {
  return modules.map((module) => module.id === id ? {
    ...module,
    version,
    artifactHash,
    localOverlayHash,
    installedAt: new Date().toISOString(),
  } : module);
}

export function restoreInstalledModule(
  modules: InstalledModule[],
  snapshot: InstalledModule,
): InstalledModule[] {
  return modules.map((module) => module.id === snapshot.id ? snapshot : module);
}

export function setModuleEnabled(
  modules: InstalledModule[],
  id: ModuleManifest['id'],
  enabled: boolean,
): InstalledModule[] {
  return modules.map((module) => module.id === id ? { ...module, enabled } : module);
}
