import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { CORE_VERSION } from '../../modules/workspaceRegistry';

// Topluluk güncellemeleri deponun main dalındaki updates/registry.json'dan
// okunur. Merge = güvenlik onayı; merge edilmemiş kayıt burada görünmez.
// Akışın tamamı updates/README.md'de belgelidir.
const REGISTRY_URL = 'https://raw.githubusercontent.com/yazicmert/FRAUDE/main/updates/registry.json';
const CONTRIBUTING_URL = 'https://github.com/yazicmert/FRAUDE/blob/main/updates/README.md';
const CACHE_KEY = 'fraude-updates-cache';
const CACHE_TTL_MS = 60 * 60 * 1000;

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

function readCache(): { fetchedAt: number; registry: UpdatesRegistry } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function UpdatesView() {
  const { t, lang } = useTranslation();
  const [updates, setUpdates] = useState<CommunityUpdate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = readCache();
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setUpdates(cached.registry.updates);
        return;
      }
    }
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const registry = (await res.json()) as UpdatesRegistry;
      if (!Array.isArray(registry.updates)) throw new Error('invalid registry');
      setUpdates(registry.updates);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), registry }));
    } catch {
      // Ağ yoksa bayat önbellek boş ekrandan iyidir
      const cached = readCache();
      if (cached) setUpdates(cached.registry.updates);
      else setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const copyPrompt = (update: CommunityUpdate) => {
    navigator.clipboard.writeText(update.agentPrompt).then(() => {
      setCopiedId(update.id);
      setTimeout(() => setCopiedId((prev) => (prev === update.id ? null : prev)), 2000);
    });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
        <h2 style={{ margin: 0 }}>{t('updates')}</h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => load(true)}
          disabled={loading}
          style={{
            padding: '6px 14px', background: loading ? '#30363d' : '#238636',
            color: '#fff', border: 'none', borderRadius: '6px',
            cursor: loading ? 'default' : 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold',
          }}
        >
          {loading ? '…' : `⟳ ${t('updatesRefresh')}`}
        </button>
      </div>
      <p style={{ color: '#8b949e', fontSize: '0.85rem', marginTop: 0 }}>{t('updatesSub')}</p>

      <p style={{ color: '#8b949e', fontSize: '0.8rem' }}>
        {t('updContribute')}{' '}
        <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>
          {t('updContributeLink')}
        </a>
      </p>

      {updates === null && loading && <p style={{ color: '#8b949e' }}>{t('updatesLoading')}</p>}
      {error && <p style={{ color: '#f85149' }}>{t('updatesLoadFailed')}</p>}
      {updates !== null && updates.length === 0 && (
        <p style={{ color: '#8b949e' }}>{t('updatesEmpty')}</p>
      )}

      {(updates ?? []).map((update) => {
        const included = update.includedIn !== null && versionLte(update.includedIn, CORE_VERSION);
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

            <h3 style={{ margin: '10px 0 6px' }}>{update.title[lang]}</h3>
            <p style={{ color: '#c9d1d9', fontSize: '0.85rem', margin: '0 0 10px' }}>
              {update.summary[lang]}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              {included ? (
                <span style={{ fontSize: '0.75rem', color: '#3fb950' }}>
                  ✓ {t('updShippedIn').replace('{v}', update.includedIn as string)} — {t('updIncludedIn')}
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#d29922' }}>{t('updNotShipped')}</span>
              )}
              <a
                href={update.commit}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.75rem', color: '#58a6ff' }}
              >
                {t('updViewCommit')}
              </a>
              {!included && (
                <button
                  onClick={() => setExpanded(open ? null : update.id)}
                  style={{
                    background: 'none', border: '1px solid #30363d', borderRadius: '6px',
                    color: '#c9d1d9', padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem',
                  }}
                >
                  {open ? '▾ ' : '▸ '}{t('updPromptTitle')}
                </button>
              )}
            </div>

            {open && !included && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ color: '#8b949e', fontSize: '0.78rem' }}>{t('updPromptHint')}</p>
                <pre style={{
                  background: '#161b22', border: '1px solid #30363d', borderRadius: '6px',
                  padding: '12px', fontSize: '0.75rem', whiteSpace: 'pre-wrap',
                  color: '#c9d1d9', maxHeight: '320px', overflowY: 'auto',
                }}>
                  {update.agentPrompt}
                </pre>
                <button
                  onClick={() => copyPrompt(update)}
                  style={{
                    padding: '6px 14px', background: '#238636', color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold',
                  }}
                >
                  {copiedId === update.id ? t('updCopied') : `⧉ ${t('updCopyPrompt')}`}
                </button>
                {update.notes && (
                  <p style={{ color: '#d29922', fontSize: '0.78rem', marginTop: '10px' }}>
                    <strong>{t('updManualNotes')}:</strong> {update.notes[lang]}
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
