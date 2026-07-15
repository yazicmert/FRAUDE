import { useMemo, useState } from 'react';
import { moduleCatalog } from './catalog';
import { readInstalledModules, setModuleEnabled, writeInstalledModules } from './storage';
import type { ModuleManifest } from './types';

export function useModuleRegistry() {
  const [installedModules, setInstalledModules] = useState(readInstalledModules);

  const modules = useMemo(() => moduleCatalog.map((manifest) => ({
    manifest,
    installed: installedModules.find((item) => item.id === manifest.id),
  })), [installedModules]);

  const toggleModule = (id: ModuleManifest['id'], enabled: boolean) => {
    setInstalledModules((current) => {
      const next = setModuleEnabled(current, id, enabled);
      writeInstalledModules(next);
      return next;
    });
  };

  const replaceInstalledModules = (next: typeof installedModules) => {
    writeInstalledModules(next);
    setInstalledModules(next);
  };

  return { modules, installedModules, toggleModule, replaceInstalledModules };
}
