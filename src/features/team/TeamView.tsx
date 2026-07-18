import React, { useEffect, useState } from 'react';
import { invokePlatform as invoke } from '../../api/platformClient';
import { runAgentAnalysis } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { AgentAnalysisResult, AiAgent, Artifact, SaveArtifactRequest, SaveAiAgentRequest } from '../../types';

export default function TeamView() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  // Tauri'nin macOS WebView'ü window.confirm desteklemez (sessizce false döner
  // ve silme hiç çalışmazdı); onay "tekrar tıkla" kalıbıyla alınır.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const timer = setTimeout(() => setPendingDelete(null), 4000);
    return () => clearTimeout(timer);
  }, [pendingDelete]);
  
  // Artifact Modal State
  const [showArtifactModal, setShowArtifactModal] = useState(false);
  const [artifactForm, setArtifactForm] = useState<SaveArtifactRequest>({ title: '', content: '' });

  // Agent linking Modal State
  const [editingAgent, setEditingAgent] = useState<AiAgent | null>(null);
  const [tickerInput, setTickerInput] = useState('');

  // Analiz çalıştırma durumu
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AgentAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const agentSaveRequest = (agent: AiAgent, patch: Partial<SaveAiAgentRequest>): SaveAiAgentRequest => ({
    id: agent.id,
    name: agent.name,
    role_description: agent.role_description,
    system_prompt: agent.system_prompt,
    api_key_id: agent.api_key_id,
    is_active: agent.is_active,
    linked_artifacts: agent.linked_artifacts || [],
    linked_tickers: agent.linked_tickers || [],
    ...patch,
  });

  const handleSaveTickers = async () => {
    if (!editingAgent) return;
    const tickers = tickerInput.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    try {
      const updated = await invoke<AiAgent>('save_ai_agent', {
        request: agentSaveRequest(editingAgent, { linked_tickers: tickers }),
      });
      setEditingAgent(updated);
      setTickerInput((updated.linked_tickers || []).join(', '));
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunAnalysis = async (agent: AiAgent) => {
    setRunningAgentId(agent.id);
    setAnalysisError(null);
    try {
      const result = await runAgentAnalysis(agent.id);
      setAnalysisResult(result);
      fetchData();
    } catch (e) {
      setAnalysisError(String(e));
    } finally {
      setRunningAgentId(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const fetchedAgents = await invoke<AiAgent[]>('list_ai_agents');
      setAgents(fetchedAgents);
      const fetchedArtifacts = await invoke<Artifact[]>('list_artifacts');
      setArtifacts(fetchedArtifacts);
    } catch (e) {
      console.error('Error fetching team data', e);
    }
  };

  const handleSaveArtifact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke('save_artifact', { request: artifactForm });
      setArtifactForm({ title: '', content: '' });
      setShowArtifactModal(false);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteArtifact = async (id: string) => {
    try {
      await invoke('delete_artifact', { id });
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setPendingDelete(null);
    }
  };

  const handleToggleArtifactForAgent = async (artifactId: string) => {
    if (!editingAgent) return;
    const isLinked = (editingAgent.linked_artifacts || []).includes(artifactId);
    let newLinked = [...(editingAgent.linked_artifacts || [])];
    if (isLinked) {
      newLinked = newLinked.filter(id => id !== artifactId);
    } else {
      newLinked.push(artifactId);
    }
    
    const request: SaveAiAgentRequest = agentSaveRequest(editingAgent, { linked_artifacts: newLinked });

    try {
      const updatedAgent = await invoke<AiAgent>('save_ai_agent', { request });
      setEditingAgent(updatedAgent);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="view team-view" style={{ padding: '24px', display: 'flex', gap: '24px', height: '100%', boxSizing: 'border-box' }}>
      
      {/* AGENTS SECTION */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 24px 0', fontSize: '1.5rem', fontWeight: 600 }}>{t('teamTitle')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {agents.map(agent => (
            <div key={agent.id} style={{
              background: 'var(--bg-panel)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--accent-primary)' }}>{agent.name}</h3>
                <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '12px', background: agent.is_active ? 'rgba(0,255,157,0.1)' : 'rgba(255,255,255,0.1)', color: agent.is_active ? 'var(--accent-primary)' : 'gray' }}>
                  {agent.is_active ? t('teamActive') : t('teamPassive')}
                </span>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0 0 16px 0', minHeight: '40px' }}>{agent.role_description}</p>
              
              <div style={{ marginTop: 'auto' }}>
                <h4 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', textTransform: 'uppercase', color: 'gray' }}>{t('teamLinkedTickers')} ({(agent.linked_tickers || []).length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {!(agent.linked_tickers && agent.linked_tickers.length > 0) ? (
                    <span style={{ fontSize: '0.8rem', color: 'gray' }}>{t('teamNoTickers')}</span>
                  ) : (
                    agent.linked_tickers.map(tk => (
                      <span key={tk} style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'rgba(0,255,157,0.08)', borderRadius: '4px', border: '1px solid rgba(0,255,157,0.25)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {tk}
                      </span>
                    ))
                  )}
                </div>
                <button
                  onClick={() => handleRunAnalysis(agent)}
                  disabled={runningAgentId !== null || !(agent.linked_tickers && agent.linked_tickers.length > 0)}
                  style={{
                    width: '100%', padding: '8px', marginBottom: '8px',
                    background: (agent.linked_tickers?.length && runningAgentId === null) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                    border: 'none', borderRadius: '6px',
                    color: (agent.linked_tickers?.length && runningAgentId === null) ? 'black' : 'gray',
                    cursor: (agent.linked_tickers?.length && runningAgentId === null) ? 'pointer' : 'default',
                    fontWeight: 600,
                  }}
                >
                  {runningAgentId === agent.id ? t('teamAnalyzing') : t('teamRunAnalysis')}
                </button>
                <h4 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', textTransform: 'uppercase', color: 'gray' }}>{t('teamLinkedArtifacts')} ({(agent.linked_artifacts || []).length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                  {!(agent.linked_artifacts && agent.linked_artifacts.length > 0) ? (
                    <span style={{ fontSize: '0.8rem', color: 'gray' }}>{t('teamNoArtifacts')}</span>
                  ) : (
                    agent.linked_artifacts.map(artId => {
                      const art = artifacts.find(a => a.id === artId);
                      return art ? (
                        <span key={artId} style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                          📄 {art.title}
                        </span>
                      ) : null;
                    })
                  )}
                </div>
                <button 
                  onClick={() => { setEditingAgent(agent); setTickerInput((agent.linked_tickers || []).join(', ')); }}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', cursor: 'pointer' }}
                >
                  {t('teamManage')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ARTIFACTS SECTION */}
      <div style={{ flex: 1, background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('teamArtifactStore')}</h2>
          <button
            onClick={() => { setArtifactForm({ title: '', content: '' }); setShowArtifactModal(true); }}
            style={{ padding: '6px 12px', background: 'var(--accent-primary)', color: 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
          >
            + {t('teamAddNew')}
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {artifacts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>{t('teamNoStoredArtifacts')}</p>
          ) : (
            artifacts.map(art => (
              <div key={art.id} style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{art.title}</h3>
                  <button
                    onClick={() => pendingDelete === art.id ? void handleDeleteArtifact(art.id) : setPendingDelete(art.id)}
                    title={pendingDelete === art.id ? t('teamDeleteConfirmTip') : t('aiDeleteRecordTitle')}
                    style={{
                      background: pendingDelete === art.id ? '#ff4d4f' : 'none',
                      border: 'none',
                      color: pendingDelete === art.id ? '#fff' : '#ff4d4f',
                      borderRadius: '4px', padding: '0 6px',
                      cursor: 'pointer', fontSize: pendingDelete === art.id ? '0.75rem' : '1.2rem', fontWeight: 700,
                    }}
                  >
                    {pendingDelete === art.id ? t('teamDeleteConfirm') : '×'}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {art.content}
                </p>
                <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'gray' }}>
                  {new Date(art.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CREATE ARTIFACT MODAL */}
      {showArtifactModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '600px', maxWidth: '90vw', border: '1px solid var(--border-color)' }}>
            <h2 style={{ marginTop: 0 }}>{t('teamCreateArtifact')}</h2>
            <form onSubmit={handleSaveArtifact} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>{t('teamDocTitle')}</label>
                <input 
                  type="text" 
                  value={artifactForm.title}
                  onChange={e => setArtifactForm({...artifactForm, title: e.target.value})}
                  required
                  style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', boxSizing: 'border-box' }}
                  placeholder={t('teamDocTitlePh')}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>{t('teamDocContent')}</label>
                <textarea 
                  value={artifactForm.content}
                  onChange={e => setArtifactForm({...artifactForm, content: e.target.value})}
                  required
                  rows={10}
                  style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', boxSizing: 'border-box', fontFamily: 'monospace' }}
                  placeholder={t('teamDocContentPh')}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowArtifactModal(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>{t('cancelBtn')}</button>
                <button type="submit" style={{ padding: '8px 16px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>{t('saveBtn')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LINK ARTIFACTS MODAL */}
      {editingAgent && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '500px', maxWidth: '90vw', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginTop: 0, marginBottom: '8px' }}>{t('teamEditAgent')}: {editingAgent.name}</h2>

            <h4 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', textTransform: 'uppercase', color: 'gray' }}>{t('teamLinkedTickers')}</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 10px 0' }}>
              {t('teamTickersHint')}
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input
                type="text"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveTickers()}
                placeholder={t('teamTickersPh')}
                style={{ flex: 1, padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontFamily: 'monospace' }}
              />
              <button onClick={handleSaveTickers} style={{ padding: '10px 16px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                {t('saveBtn')}
              </button>
            </div>

            <h4 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', textTransform: 'uppercase', color: 'gray' }}>{t('teamLinkedArtifacts')}</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '12px' }}>{t('teamArtifactsHint')}</p>
            
            <div style={{ flex: 1, maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
              {artifacts.length === 0 ? (
                <p style={{ fontSize: '0.9rem', color: 'gray' }}>{t('teamNoDocs')}</p>
              ) : (
                artifacts.map(art => {
                  const isLinked = (editingAgent.linked_artifacts || []).includes(art.id);
                  return (
                    <div 
                      key={art.id} 
                      onClick={() => handleToggleArtifactForAgent(art.id)}
                      style={{ 
                        display: 'flex', alignItems: 'center', padding: '12px', 
                        background: isLinked ? 'rgba(0,255,157,0.1)' : 'rgba(0,0,0,0.2)', 
                        border: `1px solid ${isLinked ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}`, 
                        borderRadius: '8px', cursor: 'pointer' 
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isLinked} 
                        readOnly
                        style={{ marginRight: '12px', accentColor: 'var(--accent-primary)', width: '16px', height: '16px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: isLinked ? 600 : 400, color: isLinked ? 'var(--accent-primary)' : 'white' }}>{art.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'gray', margin: '4px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{art.content.substring(0, 50)}...</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingAgent(null)} style={{ padding: '8px 24px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>{t('okBtn')}</button>
            </div>
          </div>
        </div>
      )}
      {/* ANALİZ SONUCU MODALI */}
      {analysisResult && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '720px', maxWidth: '92vw', maxHeight: '85vh', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginTop: 0, marginBottom: '4px' }}>📝 {t('teamSummaryReady')}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 16px 0' }}>
              {analysisResult.tickers.join(', ')} · {t('teamSummarySaved')} <em>{analysisResult.artifact_title}</em>
            </p>
            <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', whiteSpace: 'pre-wrap', fontSize: '0.88rem', lineHeight: 1.65 }}>
              {analysisResult.summary}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button onClick={() => setAnalysisResult(null)} style={{ padding: '8px 24px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>{t('okBtn')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ANALİZ HATASI */}
      {analysisError && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '480px', maxWidth: '90vw', border: '1px solid #f8514966' }}>
            <h3 style={{ marginTop: 0, color: '#f85149' }}>{t('teamAnalysisFailed')}</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{analysisError}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setAnalysisError(null)} style={{ padding: '8px 24px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>{t('okBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
