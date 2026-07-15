import { useState } from 'react';
import { useTranslation } from '../../api/i18n';
import type {
  DeclarativeModuleBundle,
  ModuleUpdateCandidate,
  PatchValidationReport,
  StagingRecord,
  ModuleCapabilityResult,
  ModuleContributionReceipt,
} from '../../modules/types';
import { createConflictBundle, createConflictFixPrompt } from '../../modules/updateEngine';
import {
  approveConflictPatch,
  getApprovedOverlay,
  validateConflictPatch,
} from '../../modules/patchPipeline';
import { submitModuleContribution } from '../../modules/contributionClient';

interface UpdatePreviewPanelProps {
  candidate: ModuleUpdateCandidate;
  staging: StagingRecord | null;
  onStage: (candidate: ModuleUpdateCandidate) => Promise<StagingRecord>;
  onActivate: (candidate: ModuleUpdateCandidate) => Promise<StagingRecord>;
  onRollback: () => Promise<StagingRecord>;
  runtimeContributions: DeclarativeModuleBundle['contributions'];
  capabilityResults: ModuleCapabilityResult[];
}

export default function UpdatePreviewPanel({
  candidate,
  staging,
  onStage,
  onActivate,
  onRollback,
  runtimeContributions,
  capabilityResults,
}: UpdatePreviewPanelProps) {
  const { t, lang } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [patchText, setPatchText] = useState('');
  const [patchReport, setPatchReport] = useState<PatchValidationReport | null>(null);
  const [overlayApproved, setOverlayApproved] = useState(() => Boolean(
    getApprovedOverlay(candidate.release.manifest.id, candidate.release.manifest.version),
  ));
  const [contributionReceipt, setContributionReceipt] = useState<ModuleContributionReceipt | null>(null);
  const { installed, plan, release, verification } = candidate;
  const canStage = verification.verified && plan.compatible && Boolean(release.manifest.artifact);
  const conflictPrompt = plan.conflicts.length > 0
    ? createConflictFixPrompt(createConflictBundle(installed, release, plan), lang)
    : '';

  const handleStage = async () => {
    setBusy(true);
    setError('');
    try {
      await onStage(candidate);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async () => {
    setBusy(true);
    setError('');
    try {
      await onActivate(candidate);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    setBusy(true);
    setError('');
    try {
      await onRollback();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyConflictPrompt = async () => {
    await navigator.clipboard.writeText(conflictPrompt);
    setCopied(true);
  };

  const handleValidatePatch = async () => {
    setBusy(true);
    setError('');
    try {
      setPatchReport(await validateConflictPatch(candidate, patchText));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleApprovePatch = async () => {
    try {
      await approveConflictPatch(candidate, patchText, patchReport!);
      setOverlayApproved(true);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const handleSubmitContribution = async () => {
    setBusy(true);
    setError('');
    try {
      setContributionReceipt(await submitModuleContribution(candidate));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="update-preview" data-testid="module-update-preview">
      <div className="update-preview-title">
        <div>
          <p className="eyebrow">{t('updatePreview')}</p>
          <h3>v{plan.fromVersion} → v{plan.toVersion}</h3>
        </div>
        <span className={`verification-badge ${verification.verified ? 'verified' : 'rejected'}`}>
          {verification.verified ? t('signatureVerified') : t('signatureRejected')}
        </span>
      </div>

      <p className="update-release-notes">{release.releaseNotes[lang]}</p>

      <div className="update-check-grid">
        <div className={plan.baseMatches ? 'positive' : 'negative'}>
          <strong>{plan.baseMatches ? t('baseVersionMatches') : t('baseVersionMismatch')}</strong>
          <small>{release.baseArtifactHash}</small>
        </div>
        <div className={plan.compatible ? 'positive' : 'negative'}>
          <strong>{plan.compatible ? t('coreCompatible') : t('coreIncompatible')}</strong>
          <small>{release.manifest.compatibility.fraude}</small>
        </div>
      </div>

      {plan.addedPermissions.length > 0 && (
        <div className="update-warning-block">
          <strong>{t('newPermissions')}</strong>
          <div className="permission-list">
            {plan.addedPermissions.map((permission) => <code key={permission}>{permission}</code>)}
          </div>
        </div>
      )}

      <div className="update-change-list">
        <strong>{t('fileChanges')}</strong>
        {plan.changes.map((change) => (
          <div className="update-change" key={`${change.kind}:${change.path}`}>
            <span className={`change-kind ${change.kind}`}>{change.kind}</span>
            <code>{change.path}</code>
            <small>{change.summary[lang]}</small>
          </div>
        ))}
      </div>

      {plan.conflicts.length > 0 && (
        <div className="update-conflict-block">
          <strong>{plan.conflicts.length} {t('potentialConflicts')}</strong>
          <p>{t('conflictPromptWillBeCreated')}</p>
          <textarea readOnly value={conflictPrompt} aria-label={t('aiFixPrompt')} />
          <button type="button" className="secondary-button" onClick={() => void copyConflictPrompt()}>
            {copied ? t('promptCopied') : t('copyFixPrompt')}
          </button>
          {staging?.moduleId === release.manifest.id && staging.status === 'staged' && (
            <div className="patch-review-flow">
              <label htmlFor={`patch-${release.manifest.id}`}>{t('pasteUnifiedDiff')}</label>
              <textarea
                id={`patch-${release.manifest.id}`}
                value={patchText}
                onChange={(event) => {
                  setPatchText(event.target.value);
                  setPatchReport(null);
                  setOverlayApproved(false);
                }}
                placeholder="--- a/views/module.json&#10;+++ b/views/module.json&#10;@@ -1 +1 @@"
              />
              <button type="button" className="secondary-button" disabled={busy || !patchText.trim()} onClick={() => void handleValidatePatch()}>
                {busy ? t('testingPatch') : t('validatePatch')}
              </button>
              {patchReport && (
                <div className={patchReport.valid ? 'patch-report positive' : 'patch-report negative'}>
                  <strong>{patchReport.valid ? t('patchTestsPassed') : t('patchRejected')}</strong>
                  <small>{patchReport.testsPassed} {t('testsPassed')} · {patchReport.testsFailed} {t('testsFailed')}</small>
                  {patchReport.errors.map((item) => <code key={item}>{item}</code>)}
                </div>
              )}
              {patchReport?.valid && !overlayApproved && (
                <button type="button" className="primary-button" onClick={() => void handleApprovePatch()}>
                  {t('approveOverlayCommit')}
                </button>
              )}
              {overlayApproved && <p className="positive">{t('overlayApproved')}</p>}
              {overlayApproved && !contributionReceipt && (
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleSubmitContribution()}>
                  {busy ? t('submittingContribution') : t('submitContribution')}
                </button>
              )}
              {contributionReceipt && (
                <div className="contribution-receipt positive">
                  <strong>{t('contributionSubmitted')}</strong>
                  <code>{contributionReceipt.id}</code>
                  <small>{contributionReceipt.status}</small>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!verification.verified && verification.reason && (
        <p className="negative update-error">{t('verificationReason')}: {verification.reason}</p>
      )}
      {error && <p className="negative update-error">{error}</p>}
      {staging?.moduleId === release.manifest.id && (
        <p className={staging.status === 'failed' ? 'negative' : 'positive'}>
          {t('stagingStatus')}: {staging.status}{staging.error ? ` · ${staging.error}` : ''}
        </p>
      )}

      {(!staging || staging.moduleId !== release.manifest.id || ['failed', 'rolled_back'].includes(staging.status)) && (
        <button
          type="button"
          className="primary-button"
          disabled={!canStage || busy}
          onClick={() => void handleStage()}
        >
          {busy ? t('stagingPackage') : t('approveAndStage')}
        </button>
      )}
      {staging?.moduleId === release.manifest.id && staging.status === 'staged' && (
        <button
          type="button"
          className="primary-button"
          disabled={busy || (plan.conflicts.length > 0 && !overlayApproved)}
          onClick={() => void handleActivate()}
        >
          {busy ? t('activatingModule') : t('activateUpdate')}
        </button>
      )}
      {staging?.moduleId === release.manifest.id && staging.status === 'activated' && staging.snapshotId && (
        <>
          {runtimeContributions.map((contribution) => (
            <div className="sandbox-contribution" key={`${contribution.slot}:${contribution.title.en}`}>
              <span>{t('declarativeSandbox')}</span>
              <strong>{contribution.title[lang]}</strong>
              <p>{contribution.body[lang]}</p>
            </div>
          ))}
          {capabilityResults.length > 0 && (
            <div className="capability-results">
              <span>{t('capabilityBroker')}</span>
              {capabilityResults.map((result) => (
                <div key={result.requestId} className={result.status === 'fulfilled' ? 'positive' : 'negative'}>
                  <code>{result.requestId}</code>
                  <strong>{result.status}</strong>
                  <small>{Math.round(result.durationMs)} ms</small>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="secondary-button rollback-button" disabled={busy} onClick={() => void handleRollback()}>
            {busy ? t('rollingBack') : t('rollbackUpdate')}
          </button>
        </>
      )}
      <p className="update-safety-note">
        {staging?.status === 'staged'
          ? t('activationCreatesSnapshot')
          : staging?.status === 'activated'
            ? t('moduleActivatedSnapshotReady')
            : t('stageDoesNotActivate')}
      </p>
    </section>
  );
}
