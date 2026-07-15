import { useMemo, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { getRuntimeTarget } from '../../modules/platform';
import type { InstalledModule, ModuleManifest } from '../../modules/types';
import { useModuleUpdates } from '../../modules/useModuleUpdates';
import UpdatePreviewPanel from './UpdatePreviewPanel';
import ContributionReviewPanel from './ContributionReviewPanel';
import ContributorIdentityPanel from './ContributorIdentityPanel';

interface ModuleCenterViewProps {
  modules: Array<{ manifest: ModuleManifest; installed?: InstalledModule }>;
  onToggle: (id: ModuleManifest['id'], enabled: boolean) => void;
  onInstalledModulesChange: (modules: InstalledModule[]) => void;
}

export default function ModuleCenterView({ modules, onToggle, onInstalledModulesChange }: ModuleCenterViewProps) {
  const { t, lang } = useTranslation();
  const [selectedId, setSelectedId] = useState(modules[0]?.manifest.id);
  const runtime = getRuntimeTarget();
  const updates = useModuleUpdates(
    modules.flatMap(({ installed }) => installed ? [installed] : []),
    onInstalledModulesChange,
  );
  const selected = useMemo(
    () => modules.find(({ manifest }) => manifest.id === selectedId),
    [modules, selectedId],
  );
  const selectedCandidate = updates.candidates.find(
    ({ release }) => release.manifest.id === selectedId,
  );

  return (
    <div className="view module-center">
      <div className="view-header module-center-header">
        <div>
          <p className="eyebrow">FMUP v0.1 · {runtime.toUpperCase()}</p>
          <h1>{t('moduleCenter')}</h1>
          <p className="muted">{t('moduleCenterSubtitle')}</p>
        </div>
        <div className={`module-registry-state ${updates.registryConfigured ? '' : 'offline'}`}>
          <span className="module-status-dot" />
          <div>
            <strong>{updates.registryConfigured ? t('registryConnected') : t('localCatalog')}</strong>
            <small>{updates.registryConfigured ? t('signedUpdatesReady') : t('registryPending')}</small>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={updates.checking || !updates.registryConfigured}
            onClick={() => void updates.checkForUpdates()}
          >
            {updates.checking ? t('checkingUpdates') : t('checkUpdates')}
          </button>
        </div>
      </div>

      <ContributorIdentityPanel />
      <ContributionReviewPanel />

      <div className="module-center-layout">
        <section className="panel module-list-panel">
          <div className="module-section-heading">
            <h2>{t('installedModules')}</h2>
            <span>{modules.length} {t('moduleCount')}</span>
          </div>
          <div className="module-list">
            {modules.map(({ manifest, installed }) => {
              const supported = manifest.targets.includes(runtime);
              const enabled = installed?.enabled ?? false;
              return (
                <button
                  type="button"
                  className={`module-card ${selectedId === manifest.id ? 'selected' : ''}`}
                  data-module-id={manifest.id}
                  data-testid={`module-card-${manifest.id}`}
                  key={manifest.id}
                  onClick={() => setSelectedId(manifest.id)}
                >
                  <div className="module-card-main">
                    <strong>{manifest.name[lang]}</strong>
                    <span>{manifest.description[lang]}</span>
                  </div>
                  <div className="module-card-meta">
                    <span className={`module-channel ${manifest.channel}`}>{manifest.channel}</span>
                    {updates.candidates.some(({ release }) => release.manifest.id === manifest.id)
                      && !(updates.staging?.moduleId === manifest.id && updates.staging.status === 'activated') && (
                      <span className="module-update-badge">{t('updateAvailable')}</span>
                    )}
                    <span>v{installed?.version ?? manifest.version}</span>
                    <span className={supported ? 'positive' : 'negative'}>
                      {supported ? runtime : t('unsupported')}
                    </span>
                    <label className="module-switch" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!supported}
                        onChange={(event) => onToggle(manifest.id, event.target.checked)}
                      />
                      <span>{enabled ? t('enabled') : t('disabled')}</span>
                    </label>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel module-detail-panel">
          {selected && (
            <>
              <p className="eyebrow">{selected.manifest.id}</p>
              <h2>{selected.manifest.name[lang]}</h2>
              <p className="muted">{selected.manifest.description[lang]}</p>

              <dl className="module-details">
                <div><dt>{t('moduleVersion')}</dt><dd>{selected.installed?.version ?? selected.manifest.version}</dd></div>
                <div><dt>{t('moduleChannel')}</dt><dd>{selected.manifest.channel}</dd></div>
                <div><dt>{t('moduleTargets')}</dt><dd>{selected.manifest.targets.join(' + ')}</dd></div>
                <div><dt>{t('moduleCompatibility')}</dt><dd>{selected.manifest.compatibility.fraude}</dd></div>
              </dl>

              <h3>{t('requestedPermissions')}</h3>
              <div className="permission-list">
                {selected.manifest.permissions.map((permission) => (
                  <code key={permission}>{permission}</code>
                ))}
              </div>

              <div className="update-foundation-note">
                <strong>{t('updatePreviewReady')}</strong>
                <p>{t('updatePreviewReadyDescription')}</p>
              </div>
              {selectedCandidate && (
                <UpdatePreviewPanel
                  candidate={selectedCandidate}
                  staging={updates.staging}
                  onStage={updates.stageCandidate}
                  onActivate={updates.activateCandidate}
                  onRollback={updates.rollbackCandidate}
                  runtimeContributions={updates.runtimeContributions}
                  capabilityResults={updates.capabilityResults}
                />
              )}
              {!selectedCandidate && updates.lastCheckedAt && (
                <p className="positive update-empty-state">{t('moduleUpToDate')}</p>
              )}
              {updates.error && <p className="negative update-error">{updates.error}</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
