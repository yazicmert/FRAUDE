import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { CORE_VERSION } from '../../modules/workspaceRegistry';
import { openUrl } from '../../lib/openExternal';

// Topluluk güncellemeleri deponun main dalındaki updates/registry.json'dan
// okunur. Merge = güvenlik onayı; merge edilmemiş kayıt burada görünmez.
// Gönderimler GitHub'da issue olarak açılır; akış updates/README.md'de.
const REPO = 'yazicmert/FRAUDE';
const REGISTRY_URL = `https://raw.githubusercontent.com/${REPO}/main/updates/registry.json`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CONTRIBUTING_URL = `https://github.com/${REPO}/blob/main/updates/README.md`;
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;
const DOWNLOAD_MAC = `https://github.com/${REPO}/releases/latest/download/FRAUDE-Terminal_macos_arm64.dmg`;
const DOWNLOAD_WIN = `https://github.com/${REPO}/releases/latest/download/FRAUDE-Terminal_windows_x64-setup.exe`;
const CACHE_KEY = 'fraude-updates-cache';
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

function buildEntry(form: SubmitForm): Record<string, unknown> {
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

export default function UpdatesView() {
  const { t, lang } = useTranslation();
  const [updates, setUpdates] = useState<CommunityUpdate[] | null>(null);
  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadNote, setDownloadNote] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState<SubmitForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
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

      // Son paket sürümü ayrı uçtan gelir; erişilemezse kayıt listesi yine gösterilir
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
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), registry, latestTag: tag } satisfies UpdatesCache));
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

  const submitToGithub = () => {
    if (!form.author.trim() || !form.titleTr.trim() || !form.summaryTr.trim() || !form.prompt.trim()) {
      setFormError(t('updFormMissing'));
      return;
    }
    setFormError(null);
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
    const url = `${NEW_ISSUE_URL}?labels=update-submission&title=${encodeURIComponent(`[Güncelleme] ${form.titleTr.trim()}`)}&body=${encodeURIComponent(body)}`;
    if (url.length > MAX_ISSUE_URL_LEN) {
      navigator.clipboard.writeText(json).then(() => {
        setFormError(t('updIssueTooLong'));
        void openUrl(`${NEW_ISSUE_URL}?labels=update-submission&title=${encodeURIComponent(`[Güncelleme] ${form.titleTr.trim()}`)}`);
      });
      return;
    }
    void openUrl(url);
  };

  const copyEntryJson = () => {
    const entry = buildEntry(form);
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(() => {
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 2000);
    });
  };

  const inputStyle = {
    width: '100%', background: '#161b22', border: '1px solid #30363d',
    borderRadius: '6px', color: '#c9d1d9', padding: '7px 10px', fontSize: '0.82rem',
  } as const;
  const labelStyle = { display: 'block', marginBottom: '10px', fontSize: '0.78rem', color: '#8b949e' } as const;
  const btnStyle = (primary: boolean, disabled = false) => ({
    padding: '6px 14px',
    background: disabled ? '#30363d' : primary ? '#238636' : 'transparent',
    color: disabled ? '#8b949e' : primary ? '#fff' : '#c9d1d9',
    border: primary ? 'none' : '1px solid #30363d',
    borderRadius: '6px',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold',
  } as const);

  return (
    <div style={{ padding: '20px 0', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <h2 style={{ margin: 0 }}>{t('updates')}</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => check(true)} disabled={checking} style={btnStyle(false, checking)}>
          {checking ? t('updChecking') : `⟳ ${t('updCheck')}`}
        </button>
        <button onClick={() => { setShowSubmit((v) => !v); setFormError(null); }} style={btnStyle(false)}>
          ＋ {t('updSubmit')}
        </button>
        {newVersionAvailable && (
          <button onClick={downloadInstaller} style={btnStyle(true)}>
            ⬆ {t('updUpdateApp')}
          </button>
        )}
      </div>
      <p style={{ color: '#8b949e', fontSize: '0.85rem', marginTop: 0 }}>{t('updatesSub')}</p>

      {checkedAt && updates !== null && (
        <p style={{ color: '#8b949e', fontSize: '0.78rem' }}>
          {checkedAt} · {(latestTag
            ? t('updCheckStatus').replace('{v}', latestTag)
            : t('updCheckStatusNoRelease')
          ).replace('{n}', String(updates.length))}
        </p>
      )}
      {latestTag !== null && (
        newVersionAvailable ? (
          <p style={{ color: '#d29922', fontSize: '0.85rem', fontWeight: 'bold' }}>
            ⬆ {t('updNewVersion').replace('{v}', latestTag)}
          </p>
        ) : (
          <p style={{ color: '#3fb950', fontSize: '0.85rem' }}>
            ✓ {t('updUpToDate').replace('{v}', CORE_VERSION)}
          </p>
        )
      )}
      {downloadNote && (
        <p style={{ color: '#58a6ff', fontSize: '0.8rem' }}>{t('updDownloadStarted')}</p>
      )}

      {showSubmit && (
        <div style={{
          border: '1px solid #30363d', borderRadius: '8px', padding: '16px',
          marginBottom: '16px', background: '#0d1117',
        }}>
          <h3 style={{ marginTop: 0 }}>{t('updSubmit')}</h3>
          <p style={{ color: '#8b949e', fontSize: '0.78rem' }}>
            {t('updSubmitHint')}{' '}
            <button onClick={() => void openUrl(CONTRIBUTING_URL)} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, fontSize: '0.78rem' }}>
              {t('updContributeLink')}
            </button>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <label style={labelStyle}>
              {t('updFldAuthor')}
              <input style={inputStyle} value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                {t('updFldKind')}
                <select style={inputStyle} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'fix' | 'feature' })}>
                  <option value="fix">{t('updKindFix')}</option>
                  <option value="feature">{t('updKindFeature')}</option>
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1 }}>
                {t('updFldArea')}
                <select style={inputStyle} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                  {['app', 'core', 'site', 'server', 'infra'].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            </div>
            <label style={labelStyle}>
              {t('updFldTitleTr')}
              <input style={inputStyle} value={form.titleTr} onChange={(e) => setForm({ ...form, titleTr: e.target.value })} />
            </label>
            <label style={labelStyle}>
              {t('updFldTitleEn')}
              <input style={inputStyle} value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
            </label>
            <label style={labelStyle}>
              {t('updFldSummaryTr')}
              <textarea style={{ ...inputStyle, minHeight: '58px' }} value={form.summaryTr} onChange={(e) => setForm({ ...form, summaryTr: e.target.value })} />
            </label>
            <label style={labelStyle}>
              {t('updFldSummaryEn')}
              <textarea style={{ ...inputStyle, minHeight: '58px' }} value={form.summaryEn} onChange={(e) => setForm({ ...form, summaryEn: e.target.value })} />
            </label>
          </div>
          <label style={labelStyle}>
            {t('updFldPrompt')}
            <textarea
              style={{ ...inputStyle, minHeight: '120px', fontFamily: 'var(--font-mono)' }}
              placeholder={t('updFldPromptPh')}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <label style={labelStyle}>
              {t('updFldTouches')}
              <input style={inputStyle} value={form.touches} onChange={(e) => setForm({ ...form, touches: e.target.value })} />
            </label>
            <label style={labelStyle}>
              {t('updFldCommit')}
              <input style={inputStyle} value={form.commit} onChange={(e) => setForm({ ...form, commit: e.target.value })} />
            </label>
          </div>
          {formError && <p style={{ color: '#f85149', fontSize: '0.8rem' }}>{formError}</p>}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={submitToGithub} style={btnStyle(true)}>{t('updOpenIssue')}</button>
            <button onClick={copyEntryJson} style={btnStyle(false)}>
              {jsonCopied ? t('updJsonCopied') : `⧉ ${t('updCopyJson')}`}
            </button>
            <button onClick={() => { setShowSubmit(false); setForm(EMPTY_FORM); setFormError(null); }} style={btnStyle(false)}>
              {t('updCancel')}
            </button>
          </div>
        </div>
      )}

      {updates === null && checking && <p style={{ color: '#8b949e' }}>{t('updatesLoading')}</p>}
      {error && <p style={{ color: '#f85149' }}>{t('updatesLoadFailed')}</p>}
      {updates !== null && updates.length === 0 && (
        <p style={{ color: '#8b949e' }}>{t('updatesEmpty')}</p>
      )}

      {(updates ?? []).map((update) => {
        const included = update.includedIn !== null && versionLte(update.includedIn, CORE_VERSION);
        const shippedInNewer = update.includedIn !== null && !included;
        const open = expanded === update.id;
        return (
          <div
            key={update.id}
            style={{
              border: '1px solid #30363d', borderRadius: '8px',
              padding: '14px 16px', marginBottom: '12px', background: '#0d1117',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{
                padding: '2px 8px', borderRadius: '10px', fontSize: '0.68rem', fontWeight: 'bold',
                background: update.kind === 'fix' ? '#f8514922' : '#23863622',
                color: update.kind === 'fix' ? '#f85149' : '#3fb950',
              }}>
                {update.kind === 'fix' ? t('updKindFix') : t('updKindFeature')}
              </span>
              <span style={{
                padding: '2px 8px', borderRadius: '10px', fontSize: '0.68rem',
                background: '#30363d', color: '#8b949e', fontFamily: 'var(--font-mono)',
              }}>
                {update.area}
              </span>
              {update.security.reviewed && (
                <span style={{ fontSize: '0.7rem', color: '#3fb950' }}>{t('updSecurityOk')}</span>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '0.72rem', color: '#8b949e', fontFamily: 'var(--font-mono)' }}>
                {update.date} · {update.author}
              </span>
            </div>

            <h3 style={{ margin: '10px 0 6px' }}>{update.title[lang as 'tr' | 'en']}</h3>
            <p style={{ color: '#c9d1d9', fontSize: '0.85rem', margin: '0 0 10px' }}>
              {update.summary[lang as 'tr' | 'en']}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {included ? (
                <span style={{ fontSize: '0.75rem', color: '#3fb950' }}>
                  ✓ {t('updShippedIn').replace('{v}', update.includedIn as string)} — {t('updIncludedIn')}
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#d29922' }}>{t('updNotShipped')}</span>
              )}
              <button
                onClick={() => void openUrl(update.commit)}
                style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, fontSize: '0.75rem' }}
              >
                {t('updViewCommit')}
              </button>
              {included ? (
                <button disabled style={btnStyle(false, true)}>✓ {t('updApplyIncluded')}</button>
              ) : shippedInNewer ? (
                <button onClick={downloadInstaller} style={btnStyle(true)}>⬆ {t('updApply')}</button>
              ) : (
                <button onClick={() => setExpanded(open ? null : update.id)} style={btnStyle(true)}>
                  {open ? '▾' : '▸'} {t('updApply')}
                </button>
              )}
            </div>

            {open && !included && !shippedInNewer && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ color: '#8b949e', fontSize: '0.78rem' }}>{t('updPromptHint')}</p>
                <pre style={{
                  background: '#161b22', border: '1px solid #30363d', borderRadius: '6px',
                  padding: '12px', fontSize: '0.75rem', whiteSpace: 'pre-wrap',
                  color: '#c9d1d9', maxHeight: '320px', overflowY: 'auto',
                }}>
                  {update.agentPrompt}
                </pre>
                <button onClick={() => copyPrompt(update)} style={btnStyle(true)}>
                  {copiedId === update.id ? t('updCopied') : `⧉ ${t('updCopyPrompt')}`}
                </button>
                {update.notes && (
                  <p style={{ color: '#d29922', fontSize: '0.78rem', marginTop: '10px' }}>
                    <strong>{t('updManualNotes')}:</strong> {update.notes[lang as 'tr' | 'en']}
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
