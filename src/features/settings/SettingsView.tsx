import { FormEvent, useEffect, useState } from 'react';
import {
  deleteAiKey,
  listAiKeys,
  saveAiKey,
  setDefaultAiKey,
  testAiKey,
  listAiAgents,
  saveAiAgent,
  deleteAiAgent,
} from '../../api/tauriClient';
import type { AiKeyRecord, SaveAiKeyRequest, AiAgent, SaveAiAgentRequest } from '../../types';
import { useTranslation } from '../../api/i18n';
import { getSession, signOut } from '../auth/session';
import { checkLicense, licenseOverview, type LicenseOverview } from '../auth/license';

const emptyForm: SaveAiKeyRequest = {
  provider: 'openai',
  label: '',
  api_key: '',
  default_model: 'gpt-4o',
  enabled: true,
  api_url: 'https://api.openai.com/v1',
};

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o1',
    'o1-mini'
  ],
  deepseek: [
    'deepseek-chat',     // DeepSeek-V3
    'deepseek-reasoner'  // DeepSeek-R1
  ],
  qwen: [
    'qwen-max',          // En güçlü model (genellikle Qwen 3)
    'qwen-plus',         // Dengeli model
    'qwen-turbo',        // Hızlı model
    'qwen-long',         // Uzun bağlam
    'qwen-coder-plus',
    'qwen2.5-72b-instruct'
  ],
  google: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-pro-exp-02-05',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash'
  ],
  custom: [
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'meta-llama/Llama-3-70b-chat-hf',
    'mistralai/Mistral-7B-Instruct-v0.2'
  ]
};

const emptyAgentForm: SaveAiAgentRequest = {
  name: '',
  role_description: '',
  system_prompt: 'Sen bir BIST finans analistisin...',
  api_key_id: '',
  is_active: true,
};

export default function SettingsView() {
  const { t } = useTranslation();
  const account = getSession();
  const [activeTab, setActiveTab] = useState<'account' | 'keys' | 'agents'>('account');
  const [license, setLicense] = useState<LicenseOverview | null | 'loading'>('loading');

  // Hesap sekmesi: lisans özeti (cihaz listesi RPC'si yoksa temel bilgiye düş).
  useEffect(() => {
    if (!account) {
      setLicense(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const overview = await licenseOverview();
      if (overview) {
        if (!cancelled) setLicense(overview);
        return;
      }
      const basic = await checkLicense(account.id);
      if (cancelled) return;
      setLicense(
        basic.ok
          ? { plan: basic.plan, expiresAt: basic.expiresAt, maxDevices: 0, activatedAt: null, devices: [] }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);
  const [keys, setKeys] = useState<AiKeyRecord[]>([]);
  const [form, setForm] = useState<SaveAiKeyRequest>(emptyForm);
  const [message, setMessage] = useState('');

  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [agentForm, setAgentForm] = useState<SaveAiAgentRequest>(emptyAgentForm);
  const [agentMessage, setAgentMessage] = useState('');

  const load = async () => {
    setKeys(await listAiKeys());
    setAgents(await listAiAgents());
  };

  useEffect(() => {
    void load();
  }, []);

  const handleProviderChange = (provider: string) => {
    let default_model = 'gpt-4o';
    let api_url = 'https://api.openai.com/v1';
    let label = '';

    if (provider === 'deepseek') {
      default_model = 'deepseek-chat';
      api_url = 'https://api.deepseek.com/v1';
      label = 'DeepSeek Analyst';
    } else if (provider === 'qwen') {
      default_model = 'qwen-max';
      api_url = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      label = 'Qwen Analyst';
    } else if (provider === 'google') {
      default_model = 'gemini-2.5-flash';
      api_url = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      label = 'Google Gemini Analyst';
    } else if (provider === 'custom') {
      default_model = '';
      api_url = '';
      label = 'Custom Model';
    } else {
      label = 'OpenAI Analyst';
    }

    setForm((current) => ({
      ...current,
      provider,
      default_model,
      api_url,
      label: current.label || label,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await saveAiKey(form);
      setForm(emptyForm);
      setMessage('AI key saved. Plaintext key was not returned to the UI.');
      await load();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const submitAgent = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await saveAiAgent(agentForm);
      setAgentForm(emptyAgentForm);
      setAgentMessage('Agent saved successfully.');
      await load();
    } catch (error) {
      setAgentMessage(String(error));
    }
  };

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">Fraude Configuration</p>
          <h1>Settings</h1>
        </div>
        {account && (
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              {t('authSignedInAs')}: {account.name} · {account.email}
            </p>
            <button
              type="button"
              onClick={signOut}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid rgba(255,106,94,0.4)',
                background: 'transparent',
                color: '#ff6a5e',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              {t('authSignOut')}
            </button>
          </div>
        )}
      </div>

      <div className="tabs" style={{ display: 'flex', gap: '12px', padding: '0 24px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <button type="button" onClick={() => setActiveTab('account')} style={{ padding: '8px 16px', borderBottom: activeTab === 'account' ? '2px solid var(--accent-primary)' : 'none', background: 'transparent', color: activeTab === 'account' ? 'var(--text-primary)' : 'var(--text-muted)' }}>{t('authAccount')}</button>
        <button type="button" onClick={() => setActiveTab('keys')} style={{ padding: '8px 16px', borderBottom: activeTab === 'keys' ? '2px solid var(--accent-primary)' : 'none', background: 'transparent', color: activeTab === 'keys' ? 'var(--text-primary)' : 'var(--text-muted)' }}>AI Providers</button>
        <button type="button" onClick={() => setActiveTab('agents')} style={{ padding: '8px 16px', borderBottom: activeTab === 'agents' ? '2px solid var(--accent-primary)' : 'none', background: 'transparent', color: activeTab === 'agents' ? 'var(--text-primary)' : 'var(--text-muted)' }}>AI Agents</button>
      </div>

      {activeTab === 'account' && (
        <>
          <section className="panel">
            <h2>{t('authProfile')}</h2>
            {account ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 24px', fontSize: '13px', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('authName')}</span>
                <span>{account.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{t('authEmail')}</span>
                <span>{account.email}</span>
                <span style={{ color: 'var(--text-muted)' }}>{t('authMemberSince')}</span>
                <span>{new Date(account.createdAt).toLocaleDateString()}</span>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</p>
            )}
          </section>

          <section className="panel">
            <h2>{t('authLicense')}</h2>
            {license === 'loading' ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('authLicenseChecking')}</p>
            ) : license ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 24px', fontSize: '13px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('authLicenseStatus')}</span>
                  <span>
                    <span style={{ background: 'rgba(0,232,150,0.12)', color: '#00e896', padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600 }}>
                      {t('authLicenseActive')}
                    </span>
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{t('authLicensePlan')}</span>
                  <span style={{ textTransform: 'capitalize' }}>{license.plan}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{t('authLicenseExpires')}</span>
                  <span>{license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : t('authLicenseNoExpiry')}</span>
                  {license.maxDevices > 0 && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>{t('authLicenseDevices')}</span>
                      <span>{license.devices.length} / {license.maxDevices}</span>
                    </>
                  )}
                </div>
                {license.devices.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {license.devices.map((device, index) => (
                      <li key={index} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '13px', border: '1px solid var(--border-color, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '8px 12px' }}>
                        <span>{device.device_name ?? 'unknown'}</span>
                        {device.current && (
                          <span style={{ color: '#00e896', fontSize: '11px' }}>● {t('authThisDevice')}</span>
                        )}
                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '11px' }}>
                          {new Date(device.last_seen_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('authLicenseMissing')}</p>
            )}
          </section>

          <section className="panel">
            <h2>{t('authSignedInAs')}</h2>
            <button
              type="button"
              onClick={signOut}
              style={{ padding: '8px 18px', borderRadius: '6px', border: '1px solid rgba(255,106,94,0.4)', background: 'transparent', color: '#ff6a5e', cursor: 'pointer', fontSize: '13px' }}
            >
              {t('authSignOut')}
            </button>
          </section>
        </>
      )}

      {activeTab === 'keys' && (
        <>
      <section className="panel">
        <h2>AI Providers</h2>
        <form className="settings-form" onSubmit={submit}>
          <label>
            Provider
            <select
              value={form.provider}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen (Alibaba)</option>
              <option value="google">Google Gemini</option>
              <option value="custom">Custom Provider</option>
            </select>
          </label>
          <label>
            Label
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="e.g. Personal DeepSeek"
              required
            />
          </label>
          <label>
            API Key
            <input
              value={form.api_key}
              onChange={(event) => setForm((current) => ({ ...current, api_key: event.target.value }))}
              placeholder={form.provider === 'google' ? 'AIza...' : 'sk-...'}
              type="password"
              required
            />
          </label>
          <label>
            Default Model
            <input
              list="model-options"
              value={form.default_model}
              onChange={(event) => setForm((current) => ({ ...current, default_model: event.target.value }))}
              placeholder="Listeden seçin veya kendi modelinizi yazın"
              required
            />
            <datalist id="model-options">
              {(PROVIDER_MODELS[form.provider] || PROVIDER_MODELS['custom']).map(model => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label>
            Base API URL (Optional)
            <input
              value={form.api_url || ''}
              onChange={(event) => setForm((current) => ({ ...current, api_url: event.target.value }))}
              placeholder="e.g. https://api.deepseek.com/v1"
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              type="checkbox"
            />
            Enabled
          </label>
          <button type="submit" className="primary-button">Save Key</button>
        </form>
        {message && <p className="status-line">{message}</p>}
      </section>

      <section className="panel">
        <h2>Configured Keys</h2>
        <div className="key-list">
          {keys.map((key) => (
            <article className="key-row" key={key.id}>
              <div>
                <strong>{key.label}</strong>
                <span>{key.provider} / {key.default_model} / {key.masked_key}</span>
                {key.api_url && <small style={{ display: 'block', color: 'var(--text-muted)' }}>URL: {key.api_url}</small>}
              </div>
              <span className={key.enabled ? 'positive' : 'negative'}>{key.enabled ? 'enabled' : 'disabled'}</span>
              <span>{key.is_default ? 'default' : 'standby'}</span>
              <button type="button" onClick={() => void setDefaultAiKey(key.id).then(setKeys)}>Default</button>
              <button
                type="button"
                onClick={() =>
                  void testAiKey(key.id)
                    .then(setMessage)
                    .catch((error: unknown) => setMessage(String(error)))
                }
              >
                Test
              </button>
              <button type="button" onClick={() => void deleteAiKey(key.id).then(setKeys)}>Delete</button>
            </article>
          ))}
          {keys.length === 0 && <p className="muted">No AI keys configured yet.</p>}
        </div>
      </section>
        </>
      )}

      {activeTab === 'agents' && (
        <>
      <section className="panel">
        <h2>AI Agents</h2>
        <form className="settings-form" onSubmit={submitAgent}>
          <label>
            Agent Name
            <input
              value={agentForm.name}
              onChange={(event) => setAgentForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Kıdemli Teknik Analist"
              required
            />
          </label>
          <label>
            Role Description
            <input
              value={agentForm.role_description}
              onChange={(event) => setAgentForm((current) => ({ ...current, role_description: event.target.value }))}
              placeholder="e.g. Destek ve direnç seviyelerine odaklanır"
              required
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            System Prompt
            <textarea
              className="ai-form-textarea"
              value={agentForm.system_prompt}
              onChange={(event) => setAgentForm((current) => ({ ...current, system_prompt: event.target.value }))}
              placeholder="Sen bir teknik analiz uzmanısın..."
              rows={4}
              required
              style={{
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                padding: '12px',
                borderRadius: '6px',
                resize: 'vertical',
                minHeight: '100px'
              }}
            />
          </label>
          <label>
            Provider Key
            <select
              value={agentForm.api_key_id}
              onChange={(event) => setAgentForm((current) => ({ ...current, api_key_id: event.target.value }))}
              required
            >
              <option value="">Select a Provider Key</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>{k.label} ({k.provider})</option>
              ))}
            </select>
          </label>
          <button 
            type="submit" 
            className="primary-button" 
            style={{ 
              gridColumn: '1 / -1', 
              justifySelf: 'end', 
              marginTop: '12px', 
              padding: '8px 24px', 
              background: 'var(--accent-primary)',
              color: '#000',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Save Agent
          </button>
        </form>
        {agentMessage && <p className="status-line">{agentMessage}</p>}
      </section>

      <section className="panel">
        <h2>Configured Agents</h2>
        <div className="key-list">
          {agents.map((agent) => (
            <article className="key-row" key={agent.id}>
              <div>
                <strong>{agent.name}</strong>
                <span>{agent.role_description}</span>
                <small style={{ display: 'block', color: 'var(--text-muted)' }}>Key: {keys.find(k => k.id === agent.api_key_id)?.label || agent.api_key_id}</small>
              </div>
              <button type="button" onClick={() => void deleteAiAgent(agent.id).then(setAgents)}>Delete</button>
            </article>
          ))}
          {agents.length === 0 && <p className="muted">No agents configured yet.</p>}
        </div>
      </section>
        </>
      )}
    </div>
  );
}
