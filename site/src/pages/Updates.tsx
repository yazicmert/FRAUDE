import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

// Uygulamadaki Güncellemeler sekmesiyle aynı kaynak: deponun main dalındaki
// updates/registry.json. Merge = güvenlik onayı; akış updates/README.md'de.
const REGISTRY_URL = 'https://raw.githubusercontent.com/yazicmert/FRAUDE/main/updates/registry.json';
const CONTRIBUTING_URL = 'https://github.com/yazicmert/FRAUDE/blob/main/updates/README.md';

interface LocalizedText {
  tr: string;
  en: string;
}

interface CommunityUpdate {
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

export default function Updates() {
  const { t, lang } = useI18n();
  const [updates, setUpdates] = useState<CommunityUpdate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(REGISTRY_URL, { headers: { accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((registry) => {
        if (!Array.isArray(registry.updates)) throw new Error('invalid registry');
        setUpdates(registry.updates as CommunityUpdate[]);
      })
      .catch(() => setFailed(true));
  }, []);

  const copyPrompt = (update: CommunityUpdate) => {
    navigator.clipboard.writeText(update.agentPrompt).then(() => {
      setCopiedId(update.id);
      setTimeout(() => setCopiedId((prev) => (prev === update.id ? null : prev)), 2000);
    });
  };

  return (
    <div className="page">
      <h1>{t('updTitle')}</h1>
      <p className="page-sub" style={{ maxWidth: 720 }}>{t('updSub')}</p>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t('updHowTitle')}</h3>
        <ol style={{ margin: '8px 0', paddingLeft: 22, lineHeight: 1.7 }}>
          <li>{t('updHow1')}</li>
          <li>{t('updHow2')}</li>
          <li>{t('updHow3')}</li>
          <li>{t('updHow4')}</li>
        </ol>
        <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">
          {t('updGuideLink')}
        </a>
      </div>

      {updates === null && !failed && <p className="muted">{t('updLoading')}</p>}
      {failed && <p className="muted">{t('updLoadFailed')}</p>}
      {updates !== null && updates.length === 0 && <p className="muted">{t('updEmpty')}</p>}

      {(updates ?? []).map((update) => {
        const open = expanded === update.id;
        return (
          <div className="card" key={update.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${update.kind === 'fix' ? 'badge-red' : 'badge-green'}`}>
                {update.kind === 'fix' ? t('updKindFix') : t('updKindFeature')}
              </span>
              <span className="badge badge-gray">{update.area}</span>
              {update.security.reviewed && (
                <span className="small" style={{ color: '#3fb950' }}>{t('updSecurityOk')}</span>
              )}
              <div style={{ flex: 1 }} />
              <span className="muted small">
                {update.date} · {update.author}
              </span>
            </div>
            <h3 style={{ margin: '10px 0 6px' }}>{update.title[lang]}</h3>
            <p style={{ margin: '0 0 10px' }}>{update.summary[lang]}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="muted small">
                {update.includedIn
                  ? t('updShippedIn').replace('{v}', update.includedIn)
                  : t('updNotShipped')}
              </span>
              <a href={update.commit} target="_blank" rel="noreferrer" className="small">
                {t('updViewCommit')}
              </a>
              <button className="btn btn-sm" onClick={() => setExpanded(open ? null : update.id)}>
                {open ? '▾' : '▸'} {t('updPromptTitle')}
              </button>
            </div>
            {open && (
              <div style={{ marginTop: 12 }}>
                <p className="muted small">{t('updPromptHint')}</p>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap', fontSize: '0.78rem', lineHeight: 1.55,
                    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, padding: 12, maxHeight: 340, overflowY: 'auto',
                    textAlign: 'left',
                  }}
                >
                  {update.agentPrompt}
                </pre>
                <button className="btn btn-primary btn-sm" onClick={() => copyPrompt(update)}>
                  {copiedId === update.id ? t('updCopied') : `⧉ ${t('updCopy')}`}
                </button>
                {update.notes && (
                  <p className="muted small" style={{ marginTop: 10 }}>
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
