import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { CORE_VERSION } from '../../modules/workspaceRegistry';
import { openUrl } from '../../lib/openExternal';
import { submitUpdateViaPr, type PrStep } from './githubSubmit';
import './UpdatesView.css';

// Topluluk güncellemeleri deponun main dalındaki updates/registry.json'dan
// okunur. Merge = güvenlik onayı; merge edilmemiş kayıt burada görünmez.
// Gönderim: token varsa otomatik PR (githubSubmit), yoksa önceden doldurulmuş
// issue taslağı. Akışın tamamı updates/README.md'de belgelidir.
const REPO = 'yazicmert/FRAUDE';
const REGISTRY_URL = `https://raw.githubusercontent.com/${REPO}/main/updates/registry.json`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CONTRIBUTING_URL = `https://github.com/${REPO}/blob/main/updates/README.md`;
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;
const DOWNLOAD_MAC = `https://github.com/${REPO}/releases/latest/download/FRAUDE-Terminal_macos_arm64.dmg`;
const DOWNLOAD_WIN = `https://github.com/${REPO}/releases/latest/download/FRAUDE-Terminal_windows_x64-setup.exe`;
const CACHE_KEY = 'fraude-updates-cache';
const TOKEN_KEY = 'fraude-github-token';
const CACHE_TTL_MS = 60 * 60 * 1000;
// GitHub ~8 KB üzerindeki URL'leri reddeder; taslak gövde bunu aşarsa
// JSON panoya kopyalanıp boş issue sayfası açılır.
const MAX_ISSUE_URL_LEN = 7000;

interface LocalizedText {
  tr: string;
  en: string;
}

export interface CommunityUpdate {
  id: string;
  date: string;
  author: string;
  kind: 'fix' | 'feature';
  area: string;
  title: LocalizedText;
  summary: LocalizedText;
  commit: string;
  includedIn: string | null;
  security: { reviewed: boolean; reviewer: string };
  touches: string[];
  agentPrompt: string;
  notes: LocalizedText | null;
}

interface UpdatesRegistry {
  schemaVersion: number;
  updates: CommunityUpdate[];
}

interface UpdatesCache {
  fetchedAt: number;
  registry: UpdatesRegistry;
  latestTag?: string | null;
}

/** "0.1.0" biçimli sürümleri karşılaştırır: a <= b ise true. */
function versionLte(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

function readCache(): UpdatesCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function installerUrl(): string {
  return navigator.userAgent.includes('Windows') ? DOWNLOAD_WIN : DOWNLOAD_MAC;
}

function slugify(text: string): string {
  const map: Record<string, string> = {
    ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g',
    ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
  };
  return text
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

interface SubmitForm {
  author: string;
  kind: 'fix' | 'feature';
  area: string;
  titleTr: string;
  titleEn: string;
  summaryTr: string;
  summaryEn: string;
  prompt: string;
  touches: string;
  commit: string;
}

const EMPTY_FORM: SubmitForm = {
  author: '', kind: 'fix', area: 'app', titleTr: '', titleEn: '',
  summaryTr: '', summaryEn: '', prompt: '', touches: '', commit: '',
};

function buildEntry(form: SubmitForm) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `${today}-${slugify(form.titleTr)}`,
    date: today,
    author: form.author.trim(),
    kind: form.kind,
    area: form.area,
    title: { tr: form.titleTr.trim(), en: (form.titleEn || form.titleTr).trim() },
    summary: { tr: form.summaryTr.trim(), en: (form.summaryEn || form.summaryTr).trim() },
    commit: form.commit.trim() || `https://github.com/${REPO}`,
    includedIn: null,
    security: { reviewed: false, reviewer: '' },
    touches: form.touches.split(',').map((s) => s.trim()).filter(Boolean),
    agentPrompt: form.prompt.trim(),
    notes: null,
  };
}

type Filter = 'all' | 'feature' | 'fix';

export default function UpdatesView() {
  const { t, lang } = useTranslation();
  const locale = (lang === 'en' ? 'en' : 'tr') as 'tr' | 'en';
  const [updates, setUpdates] = useState<CommunityUpdate[] | null>(null);
  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadNote, setDownloadNote] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState<SubmitForm>(EMPTY_FORM);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [prStep, setPrStep] = useState<PrStep | 'done' | null>(null);
  const [jsonCopied, setJsonCopied] = useState(false);

  const check = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = readCache();
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setUpdates(cached.registry.updates);
        setLatestTag(cached.latestTag ?? null);
        return;
      }
    }
    setChecking(true);
    setError(false);
    try {
      const res = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const registry = (await res.json()) as UpdatesRegistry;
      if (!Array.isArray(registry.updates)) throw new Error('invalid registry');

      // Son paket sürümü ayrı uçtan gelir; erişilemezse liste yine gösterilir
      let tag: string | null = null;
      try {
        const rel = await fetch(LATEST_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
        if (rel.ok) {
          const body = (await rel.json()) as { tag_name?: string };
          tag = body.tag_name?.replace(/^v/, '') ?? null;
        }
      } catch {
        // sürüm bilgisi olmadan devam
      }

      setUpdates(registry.updates);
      setLatestTag(tag);
      setCheckedAt(new Date().toLocaleTimeString());
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), registry, latestTag: tag } satisfies UpdatesCache),
      );
    } catch {
      // Ağ yoksa bayat önbellek boş ekrandan iyidir
      const cached = readCache();
      if (cached) {
        setUpdates(cached.registry.updates);
        setLatestTag(cached.latestTag ?? null);
      } else {
        setError(true);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check(false);
  }, [check]);

  const newVersionAvailable = latestTag !== null && !versionLte(latestTag, CORE_VERSION);

  const downloadInstaller = () => {
    void openUrl(installerUrl());
    setDownloadNote(true);
  };

  const copyPrompt = (update: CommunityUpdate) => {
    navigator.clipboard.writeText(update.agentPrompt).then(() => {
      setCopiedId(update.id);
      setTimeout(() => setCopiedId((prev) => (prev === update.id ? null : prev)), 2000);
    });
  };

  const validateForm = (): boolean => {
    if (!form.author.trim() || !form.titleTr.trim() || !form.summaryTr.trim() || !form.prompt.trim()) {
      setFormError(t('updFormMissing'));
      return false;
    }
    setFormError(null);
    return true;
  };

  const submitViaIssue = () => {
    if (!validateForm()) return;
    const entry = buildEntry(form);
    const json = JSON.stringify(entry, null, 2);
    const body = [
      'Yeni topluluk güncellemesi gönderimi. Bakımcı: güvenlik incelemesinden sonra',
      'bu kaydı `updates/registry.json` dizisinin başına ekleyin (bkz. updates/README.md).',
      '',
      '```json',
      json,
      '```',
    ].join('\n');
    const titleParam = encodeURIComponent(`[Güncelleme] ${form.titleTr.trim()}`);
    const url = `${NEW_ISSUE_URL}?labels=update-submission&title=${titleParam}&body=${encodeURIComponent(body)}`;
    if (url.length > MAX_ISSUE_URL_LEN) {
      navigator.clipboard.writeText(json).then(() => {
        setFormError(t('updIssueTooLong'));
        void openUrl(`${NEW_ISSUE_URL}?labels=update-submission&title=${titleParam}`);
      });
      return;
    }
    void openUrl(url);
  };

  const submitViaPr = async () => {
    if (!validateForm()) return;
    localStorage.setItem(TOKEN_KEY, token.trim());
    setPrStep('user');
    try {
      const url = await submitUpdateViaPr(token.trim(), buildEntry(form), setPrStep);
      setPrStep('done');
      void openUrl(url);
    } catch (err) {
      setPrStep(null);
      setFormError(t('updPrFailed') + (err instanceof Error ? err.message : String(err)));
    }
  };

  const copyEntryJson = () => {
    if (!validateForm()) return;
    navigator.clipboard.writeText(JSON.stringify(buildEntry(form), null, 2)).then(() => {
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 2000);
    });
  };

  const prStepLabel: Record<PrStep | 'done', string> = {
    user: t('updPrStepUser'),
    fork: t('updPrStepFork'),
    branch: t('updPrStepBranch'),
    commit: t('updPrStepCommit'),
    pr: t('updPrStepPr'),
    done: t('updPrDone'),
  };

  const visible = (updates ?? []).filter((u) => filter === 'all' || u.kind === filter);
  const busyPr = prStep !== null && prStep !== 'done';

  return (
    <div className="upd-view">
      <div className="upd-head">
        <div className="upd-head-text">
          <p className="upd-eyebrow">{t('updEyebrow')}</p>
          <h2 className="upd-title">{t('updates')}</h2>
          <p className="upd-sub">{t('updatesSub')}</p>
        </div>
        <div className="upd-actions">
          <button className="upd-btn" onClick={() => check(true)} disabled={checking}>
            {checking ? t('updChecking') : `⟳ ${t('updCheck')}`}
          </button>
          <button
            className="upd-btn"
            onClick={() => { setShowSubmit((v) => !v); setFormError(null); setPrStep(null); }}
          >
            ＋ {t('updSubmit')}
          </button>
        </div>
      </div>

      <div className="upd-status">
        {checkedAt && updates !== null && (
          <span className="upd-chip">
            {t('updLastCheck')} <b>{checkedAt}</b> · <b>{updates.length}</b> {t('updCount')}
          </span>
        )}
        {latestTag !== null && (
          <span className="upd-chip">
            {t('updLatestPkg')} <b>v{latestTag}</b>
          </span>
        )}
        {latestTag !== null && !newVersionAvailable && (
          <span className="upd-chip ok">✓ {t('updUpToDate').replace('{v}', CORE_VERSION)}</span>
        )}
      </div>

      {newVersionAvailable && (
        <div className="upd-banner">
          <div className="upd-banner-text">
            <p className="upd-banner-title">⬆ {t('updNewVersion').replace('{v}', latestTag as string)}</p>
            <p className="upd-banner-sub">{t('updBannerSub')}</p>
          </div>
          <button className="upd-btn primary" onClick={downloadInstaller}>
            {t('updUpdateApp')}
          </button>
        </div>
      )}
      {downloadNote && <p className="upd-chip ok" style={{ display: 'inline-block', marginTop: 10 }}>{t('updDownloadStarted')}</p>}

      {showSubmit && (
        <div className="upd-form">
          <h3>{t('updSubmit')}</h3>
          <p className="upd-form-hint">
            {t('updSubmitHint')}{' '}
            <button className="upd-link" onClick={() => void openUrl(CONTRIBUTING_URL)}>
              {t('updContributeLink')}
            </button>
          </p>
          <div className="upd-grid">
            <label>
              {t('updFldAuthor')}
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ flex: 1 }}>
                {t('updFldKind')}
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'fix' | 'feature' })}>
                  <option value="fix">{t('updKindFix')}</option>
                  <option value="feature">{t('updKindFeature')}</option>
                </select>
              </label>
              <label style={{ flex: 1 }}>
                {t('updFldArea')}
                <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                  {['app', 'core', 'site', 'server', 'infra'].map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {t('updFldTitleTr')}
              <input value={form.titleTr} onChange={(e) => setForm({ ...form, titleTr: e.target.value })} />
            </label>
            <label>
              {t('updFldTitleEn')}
              <input value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
            </label>
            <label>
              {t('updFldSummaryTr')}
              <textarea rows={3} value={form.summaryTr} onChange={(e) => setForm({ ...form, summaryTr: e.target.value })} />
            </label>
            <label>
              {t('updFldSummaryEn')}
              <textarea rows={3} value={form.summaryEn} onChange={(e) => setForm({ ...form, summaryEn: e.target.value })} />
            </label>
          </div>
          <label>
            {t('updFldPrompt')}
            <textarea
              rows={6}
              className="mono"
              placeholder={t('updFldPromptPh')}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <div className="upd-grid">
            <label>
              {t('updFldTouches')}
              <input value={form.touches} onChange={(e) => setForm({ ...form, touches: e.target.value })} />
            </label>
            <label>
              {t('updFldCommit')}
              <input value={form.commit} onChange={(e) => setForm({ ...form, commit: e.target.value })} />
            </label>
          </div>
          <div className="upd-token-box">
            <label>
              {t('updFldToken')}
              <input
                type="password"
                className="mono"
                value={token}
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <p className="upd-token-hint">{t('updTokenHint')}</p>
          </div>
          {formError && <p className="upd-form-err">{formError}</p>}
          <div className="upd-form-actions">
            {token.trim() ? (
              <button className="upd-btn primary" onClick={() => void submitViaPr()} disabled={busyPr}>
                {t('updOpenPr')}
              </button>
            ) : (
              <button className="upd-btn primary" onClick={submitViaIssue}>
                {t('updOpenIssue')}
              </button>
            )}
            <button className="upd-btn" onClick={copyEntryJson}>
              {jsonCopied ? t('updJsonCopied') : `⧉ ${t('updCopyJson')}`}
            </button>
            <button
              className="upd-btn danger-ghost"
              onClick={() => { setShowSubmit(false); setForm(EMPTY_FORM); setFormError(null); setPrStep(null); }}
            >
              {t('updCancel')}
            </button>
            {prStep && <span className="upd-progress">{prStepLabel[prStep]}</span>}
          </div>
        </div>
      )}

      <div className="upd-filters">
        {(['all', 'feature', 'fix'] as const).map((f) => (
          <button
            key={f}
            className={`upd-filter${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('updFilterAll') : f === 'feature' ? t('updKindFeature') : t('updKindFix')}
          </button>
        ))}
      </div>

      {updates === null && !error && (
        <>
          <div className="upd-skel" />
          <div className="upd-skel" />
        </>
      )}
      {error && (
        <div className="upd-state">
          <span className="ico">⚠</span>
          {t('updatesLoadFailed')}
        </div>
      )}
      {updates !== null && visible.length === 0 && (
        <div className="upd-state">
          <span className="ico">◌</span>
          {t('updatesEmpty')}
        </div>
      )}

      {visible.map((update) => {
        const included = update.includedIn !== null && versionLte(update.includedIn, CORE_VERSION);
        const shippedInNewer = update.includedIn !== null && !included;
        const open = expanded === update.id;
        return (
          <div className={`upd-card kind-${update.kind}`} key={update.id}>
            <div className="upd-card-head">
              <span className={`upd-badge kind-${update.kind}`}>
                {update.kind === 'fix' ? t('updKindFix') : t('updKindFeature')}
              </span>
              <span className="upd-badge area">{update.area}</span>
              {update.security.reviewed && <span className="upd-sec">{t('updSecurityOk')}</span>}
              <span className="upd-meta">
                <img
                  className="upd-avatar"
                  src={`https://github.com/${update.author}.png?size=40`}
                  alt=""
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                />
                {update.author} · {update.date}
              </span>
            </div>

            <h3 className="upd-card-title">{update.title[locale]}</h3>
            <p className="upd-card-sum">{update.summary[locale]}</p>

            <div className="upd-card-foot">
              {included ? (
                <span className="upd-ship in">
                  ✓ {t('updShippedIn').replace('{v}', update.includedIn as string)} — {t('updIncludedIn')}
                </span>
              ) : (
                <span className="upd-ship out">{t('updNotShipped')}</span>
              )}
              <button className="upd-link" onClick={() => void openUrl(update.commit)}>
                {t('updViewCommit')}
              </button>
              {included ? (
                <button className="upd-btn" disabled>✓ {t('updApplyIncluded')}</button>
              ) : shippedInNewer ? (
                <button className="upd-btn primary" onClick={downloadInstaller}>
                  ⬆ {t('updApply')}
                </button>
              ) : (
                <button className="upd-btn primary" onClick={() => setExpanded(open ? null : update.id)}>
                  {open ? '▾' : '▸'} {t('updApply')}
                </button>
              )}
            </div>

            {open && !included && !shippedInNewer && (
              <div className="upd-prompt">
                <p className="upd-prompt-hint">{t('updPromptHint')}</p>
                <div className="upd-code">
                  <div className="upd-code-bar">
                    <span>prompt</span>
                    <button onClick={() => copyPrompt(update)}>
                      {copiedId === update.id ? t('updCopied') : `⧉ ${t('updCopyPrompt')}`}
                    </button>
                  </div>
                  <pre>{update.agentPrompt}</pre>
                </div>
                {update.notes && (
                  <p className="upd-note">
                    <strong>{t('updManualNotes')}:</strong> {update.notes[locale]}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
