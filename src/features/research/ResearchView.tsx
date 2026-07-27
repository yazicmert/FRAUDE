import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from '../../api/i18n';
import {
  listAiAgents,
  getTeamConfig,
  saveTeamConfig,
  submitResearchJob,
  deleteResearchJob,
  cancelResearchJob,
} from '../../api/tauriClient';
import { dispatchResearchRefresh } from '../../lib/actions';
import { openUrl } from '../../lib/openExternal';
import type { AiAgent, ResearchJob, RoleKind, TeamConfig, JobStatus } from '../../types';

interface ResearchViewProps {
  jobs: ResearchJob[];
  unread?: number;
  refresh: () => void;
  markSeen: () => void;
  openTicker: (ticker: string) => void;
}

const ROLE_ORDER: RoleKind[] = ['fundamental', 'kap_news', 'technical', 'ownership'];

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ node, ...props }) => (
          <a
            {...props}
            style={{ color: 'var(--accent-primary)', textDecoration: 'underline', cursor: 'pointer' }}
            onClick={async (e) => {
              e.preventDefault();
              if (props.href) {
                try {
                  await openUrl(props.href);
                } catch (err) {
                  console.error('Bağlantı açılamadı:', err);
                }
              }
            }}
          />
        ),
        p: ({ node, ...props }) => <p style={{ margin: '0 0 12px 0' }} {...props} />,
        ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        li: ({ node, ...props }) => <li style={{ marginBottom: '6px' }} {...props} />,
        h1: ({ node, ...props }) => <h1 style={{ fontSize: '1.4rem', margin: '0 0 12px 0' }} {...props} />,
        h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.2rem', margin: '16px 0 8px 0' }} {...props} />,
        h3: ({ node, ...props }) => <h3 style={{ fontSize: '1.05rem', margin: '14px 0 6px 0', color: 'var(--accent-primary)' }} {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function statusMeta(status: JobStatus, t: (k: string) => string): { label: string; bg: string; color: string } {
  switch (status) {
    case 'queued':
      return { label: t('researchStatusQueued'), bg: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)' };
    case 'running':
      return { label: t('researchStatusRunning'), bg: 'rgba(0,180,255,0.12)', color: '#4db8ff' };
    case 'done':
      return { label: t('researchStatusDone'), bg: 'rgba(0,255,157,0.12)', color: 'var(--accent-primary)' };
    case 'error':
      return { label: t('researchStatusError'), bg: 'rgba(255,80,80,0.12)', color: '#ff6666' };
  }
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ResearchView({ jobs, refresh, markSeen, openTicker }: ResearchViewProps) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [team, setTeam] = useState<TeamConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'jobs' | 'team' | 'new'>('jobs');
  const [busy, setBusy] = useState(false);

  // Yeni araştırma formu
  const [newKind, setNewKind] = useState<'ticker_team' | 'custom'>('ticker_team');
  const [tickerInput, setTickerInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [customAgentId, setCustomAgentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listAiAgents().then(setAgents).catch((e) => console.error('Ajanlar alınamadı:', e));
    getTeamConfig().then(setTeam).catch((e) => console.error('Takım yapılandırması alınamadı:', e));
  }, []);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.updated_at_ms - a.updated_at_ms),
    [jobs],
  );
  const selected = useMemo(
    () => sortedJobs.find((j) => j.id === selectedId) ?? null,
    [sortedJobs, selectedId],
  );

  const activeAgents = useMemo(() => agents.filter((a) => a.is_active), [agents]);

  const agentName = (id?: string | null): string => {
    if (!id) return t('researchDefaultAgent');
    return agents.find((a) => a.id === id)?.name ?? id;
  };

  const teamCallCount = useMemo(() => {
    if (!team) return 5;
    return team.roles.length + 1; // roller + sentez
  }, [team]);

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (newKind === 'ticker_team') {
        const ticker = tickerInput.trim().toUpperCase();
        if (!ticker) {
          setError(t('researchNeedTicker'));
          return;
        }
        await submitResearchJob({ kind: 'ticker_team', ticker });
      } else {
        const prompt = promptInput.trim();
        const url = urlInput.trim();
        if (!prompt && !url) {
          setError(t('researchNeedInput'));
          return;
        }
        await submitResearchJob({
          kind: 'custom',
          prompt: prompt || undefined,
          url: url || undefined,
          agent_id: customAgentId || undefined,
        });
      }
      setTickerInput('');
      setPromptInput('');
      setUrlInput('');
      dispatchResearchRefresh();
      refresh();
      setTab('jobs');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTeam = async () => {
    if (!team) return;
    setBusy(true);
    try {
      const saved = await saveTeamConfig(team);
      setTeam(saved);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const setRoleAgent = (role: RoleKind, agentId: string) => {
    if (!team) return;
    setTeam({
      ...team,
      roles: team.roles.map((r) => (r.role === role ? { ...r, agent_id: agentId || null } : r)),
    });
  };

  const handleDelete = async (id: string) => {
    await deleteResearchJob(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelResearchJob(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const roleLabel = (role: RoleKind): string => t(`researchRole_${role}`);

  const tabBtn = (id: 'jobs' | 'team' | 'new', label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '8px 16px',
        background: tab === id ? 'var(--accent-primary)' : 'transparent',
        color: tab === id ? 'black' : 'var(--text-muted)',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="view research-view" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', boxSizing: 'border-box' }}>
      <div className="research-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{t('researchTitle')}</h2>
        <div className="research-tabs" style={{ display: 'flex', gap: '6px', marginLeft: 'auto', background: 'var(--bg-elevated)', padding: '4px', borderRadius: '8px' }}>
          {tabBtn('jobs', t('researchTabJobs'))}
          {tabBtn('new', t('researchTabNew'))}
          {tabBtn('team', t('researchTabTeam'))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', borderRadius: '8px', color: '#ff6666', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {/* JOBS TAB */}
      {tab === 'jobs' && (
        <div className="research-jobs-layout" style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
          <div className="research-job-list" style={{ flex: '0 0 320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedJobs.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('researchNoJobs')}</p>
            )}
            {sortedJobs.map((job) => {
              const meta = statusMeta(job.status, t);
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  style={{
                    background: selectedId === job.id ? 'var(--bg-elevated)' : 'var(--bg-panel)',
                    border: `1px solid ${selectedId === job.id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    borderRadius: '10px',
                    padding: '12px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</span>
                    <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '10px', background: meta.bg, color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>{job.source === 'extension' ? '🧩 ' + t('researchSourceExt') : '🖥️ ' + t('researchSourceApp')}</span>
                    <span>{formatTime(job.finished_at || job.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="research-job-detail" style={{ flex: 1, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', overflowY: 'auto', minWidth: 0 }}>
            {!selected ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('researchSelectPrompt')}</p>
            ) : (
              <div>
                <div className="research-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{selected.title}</h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {selected.kind === 'ticker_team' ? t('researchKindTeam') : t('researchKindCustom')}
                      {' · '}
                      {selected.kind === 'custom' ? agentName(selected.agent_id) : t('researchTeamRun')}
                      {' · '}{formatTime(selected.created_at)}
                    </div>
                  </div>
                  <div className="research-detail-actions" style={{ display: 'flex', gap: '6px' }}>
                    {selected.kind === 'ticker_team' && selected.input.ticker && (
                      <button onClick={() => openTicker(selected.input.ticker!)} style={btnStyle('var(--bg-elevated)')}>{t('researchOpenTicker')}</button>
                    )}
                    {selected.status === 'queued' && (
                      <button onClick={() => handleCancel(selected.id)} style={btnStyle('var(--bg-elevated)')}>{t('researchCancel')}</button>
                    )}
                    <button onClick={() => handleDelete(selected.id)} style={btnStyle('rgba(255,80,80,0.12)', '#ff6666')}>{t('researchDelete')}</button>
                  </div>
                </div>

                {selected.status === 'running' && (
                  <p style={{ color: '#4db8ff' }}>⏳ {t('researchRunningNote')}</p>
                )}
                {selected.status === 'queued' && (
                  <p style={{ color: 'var(--text-muted)' }}>{t('researchQueuedNote')}</p>
                )}
                {selected.status === 'error' && (
                  <p style={{ color: '#ff6666' }}>{selected.error || t('researchStatusError')}</p>
                )}
                {selected.status === 'done' && selected.report && (
                  <div style={{ lineHeight: 1.6 }}>
                    <Markdown content={selected.report} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* NEW TAB */}
      {tab === 'new' && (
        <div style={{ maxWidth: '640px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button onClick={() => setNewKind('ticker_team')} style={pillStyle(newKind === 'ticker_team')}>{t('researchKindTeam')}</button>
            <button onClick={() => setNewKind('custom')} style={pillStyle(newKind === 'custom')}>{t('researchKindCustom')}</button>
          </div>

          {newKind === 'ticker_team' ? (
            <div>
              <label style={labelStyle}>{t('researchTickerLabel')}</label>
              <input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="ASELS"
                style={inputStyle}
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                {t('researchTeamHint', { n: teamCallCount })}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>{t('researchPromptLabel')}</label>
                <textarea
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  rows={4}
                  placeholder={t('researchPromptPlaceholder')}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('researchUrlLabel')}</label>
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('researchAssignAgent')}</label>
                <select value={customAgentId} onChange={(e) => setCustomAgentId(e.target.value)} style={inputStyle}>
                  <option value="">{t('researchDefaultAgent')}</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <button onClick={handleSubmit} disabled={busy} style={{ ...btnStyle('var(--accent-primary)', 'black'), width: '100%', marginTop: '20px', padding: '12px', fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
            {busy ? t('researchSubmitting') : t('researchStart')}
          </button>
        </div>
      )}

      {/* TEAM TAB */}
      {tab === 'team' && team && (
        <div style={{ maxWidth: '720px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>{t('researchTeamDesc')}</p>
          <div className="research-team-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {ROLE_ORDER.map((role) => {
              const tr = team.roles.find((r) => r.role === role);
              return (
                <div key={role} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px' }}>
                  <h4 style={{ margin: '0 0 4px 0', color: 'var(--accent-primary)' }}>{roleLabel(role)}</h4>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>{t(`researchRoleDesc_${role}`)}</p>
                  <select value={tr?.agent_id ?? ''} onChange={(e) => setRoleAgent(role, e.target.value)} style={inputStyle}>
                    <option value="">{t('researchDefaultAgent')}</option>
                    {activeAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <label style={labelStyle}>{t('researchLeadAgent')}</label>
          <select
            value={team.lead_agent_id ?? ''}
            onChange={(e) => setTeam({ ...team, lead_agent_id: e.target.value || null })}
            style={{ ...inputStyle, maxWidth: '360px' }}
          >
            <option value="">{t('researchDefaultAgent')}</option>
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <div style={{ marginTop: '20px' }}>
            <button onClick={handleSaveTeam} disabled={busy} style={{ ...btnStyle('var(--accent-primary)', 'black'), padding: '10px 24px', fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
              {t('researchSaveTeam')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-secondary, var(--bg-elevated))',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  color: 'var(--text-primary, white)',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

function btnStyle(bg: string, color = 'white'): React.CSSProperties {
  return {
    padding: '7px 12px',
    background: bg,
    color,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600,
  };
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 18px',
    background: active ? 'var(--accent-primary)' : 'var(--bg-elevated)',
    color: active ? 'black' : 'var(--text-muted)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
  };
}
