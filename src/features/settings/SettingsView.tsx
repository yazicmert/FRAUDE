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
  getBridgeInfo,
  regenerateBridgeToken,
} from '../../api/tauriClient';
import type { AiKeyRecord, SaveAiKeyRequest, AiAgent, SaveAiAgentRequest, BridgeInfo } from '../../types';
import { useTranslation } from '../../api/i18n';
import { openUrl } from '../../lib/openExternal';
import { getSession, signOut, AUTH_EVENT } from '../auth/session';
import { supabase } from '../auth/supabaseClient';
import { checkLicense, licenseOverview, releaseDevice, type LicenseOverview } from '../auth/license';
import { GithubIcon } from '../../components/icons';
import UpdatesView from '../updates/UpdatesView';
import './SettingsView.css';

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
  const [activeTab, setActiveTab] = useState<'account' | 'keys' | 'agents' | 'updates'>('account');
  const [license, setLicense] = useState<LicenseOverview | null | 'loading'>('loading');
  // Cihaz çıkarılırken düğmeyi kilitler (device_id).
  const [releasing, setReleasing] = useState<string | null>(null);

  /** Cihazı lisanstan bırakır; boşalan yer başka bilgisayara açılır. */
  const dropDevice = async (deviceId: string) => {
    setReleasing(deviceId);
    try {
      if (!(await releaseDevice(deviceId))) return;
      const refreshed = await licenseOverview();
      if (refreshed) setLicense(refreshed);
    } finally {
      setReleasing(null);
    }
  };

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

  const TOKEN_KEY = 'fraude-github-token';
  const GH_USER_KEY = 'fraude-github-username';
  const [ghUser, setGhUser] = useState<string | null>(() => localStorage.getItem(GH_USER_KEY));
  const [ghInput, setGhInput] = useState(() => localStorage.getItem(GH_USER_KEY) ?? '');
  const [ghToken, setGhToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [ghSaved, setGhSaved] = useState(false);
  const [showTokenBox, setShowTokenBox] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [validatingToken, setValidatingToken] = useState(false);
  const [userChecking, setUserChecking] = useState(false);

  const handleConnectUsername = async (usernameToConnect?: string) => {
    const target = (usernameToConnect ?? ghInput).trim().replace(/^@/, '');
    if (!target) return;
    setUserChecking(true);
    setTokenError(null);
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(target)}`, {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        const body = (await res.json()) as { login?: string };
        if (typeof body.login === 'string') {
          const cleanLogin = body.login;
          localStorage.setItem(GH_USER_KEY, cleanLogin);
          setGhUser(cleanLogin);
          setGhInput(cleanLogin);
          setGhSaved(true);
          setTimeout(() => setGhSaved(false), 2000);
        } else {
          setTokenError('GitHub kullanıcısı bulunamadı.');
        }
      } else {
        setTokenError(`GitHub'da @${target} kullanıcısı bulunamadı (HTTP ${res.status}).`);
      }
    } catch {
      setTokenError('Ağ hatası: GitHub API erişilemedi.');
    } finally {
      setUserChecking(false);
    }
  };

  const handleDisconnectGh = () => {
    localStorage.removeItem(GH_USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setGhUser(null);
    setGhInput('');
    setGhToken('');
  };

  const handleSaveToken = async () => {
    const trimmed = ghToken.trim();
    if (!trimmed) {
      localStorage.removeItem(TOKEN_KEY);
      setGhSaved(false);
      setTokenError(null);
      return;
    }
    setValidatingToken(true);
    setTokenError(null);
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${trimmed}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { login?: string };
        if (typeof body.login === 'string') {
          setGhUser(body.login);
          setGhInput(body.login);
          localStorage.setItem(GH_USER_KEY, body.login);
          localStorage.setItem(TOKEN_KEY, trimmed);
          setGhSaved(true);
          setTimeout(() => setGhSaved(false), 2000);
        } else {
          setTokenError('GitHub kullanıcı adı alınamadı.');
        }
      } else {
        setTokenError(`Geçersiz GitHub token! (HTTP ${res.status})`);
      }
    } catch {
      setTokenError('Ağ hatası: GitHub API erişilemedi.');
    } finally {
      setValidatingToken(false);
    }
  };

  useEffect(() => {
    async function loadGhUser() {
      try {
        const storedUser = localStorage.getItem(GH_USER_KEY);
        if (storedUser) {
          setGhUser(storedUser);
          setGhInput(storedUser);
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        const meta = user?.user_metadata ?? {};
        const name = typeof meta.preferred_username === 'string' ? meta.preferred_username : (typeof meta.user_name === 'string' ? meta.user_name : undefined);
        if (name) {
          localStorage.setItem(GH_USER_KEY, name);
          setGhUser(name);
          setGhInput(name);
          return;
        }

        const ghIdentity = user?.identities?.find((id) => id.provider === 'github');
        if (ghIdentity?.identity_data) {
          const idData = ghIdentity.identity_data as { preferred_username?: string; user_name?: string };
          const idName = idData.preferred_username || idData.user_name;
          if (typeof idName === 'string' && idName) {
            localStorage.setItem(GH_USER_KEY, idName);
            setGhUser(idName);
            setGhInput(idName);
            return;
          }
        }

        const activeToken = localStorage.getItem(TOKEN_KEY) ?? ghToken;
        if (activeToken.trim()) {
          const res = await fetch('https://api.github.com/user', {
            headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${activeToken.trim()}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { login?: string };
            if (typeof body.login === 'string') {
              localStorage.setItem(GH_USER_KEY, body.login);
              setGhUser(body.login);
              setGhInput(body.login);
            }
          }
        }
      } catch {
        // ignore
      }
    }
    void loadGhUser();

    const handleFocus = async () => {
      void loadGhUser();
      try {
        const text = await navigator.clipboard.readText();
        const trimmed = text ? text.trim() : '';
        if ((trimmed.startsWith('ghp_') || trimmed.startsWith('github_pat_')) && trimmed !== localStorage.getItem(TOKEN_KEY)) {
          const res = await fetch('https://api.github.com/user', {
            headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${trimmed}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { login?: string };
            if (typeof body.login === 'string') {
              localStorage.setItem(TOKEN_KEY, trimmed);
              setGhToken(trimmed);
              setGhUser(body.login);
            }
          }
        }
      } catch {
        // ignore clipboard error
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener(AUTH_EVENT, loadGhUser);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener(AUTH_EVENT, loadGhUser);
    };
  }, [ghToken]);

  const [keys, setKeys] = useState<AiKeyRecord[]>([]);
  const [form, setForm] = useState<SaveAiKeyRequest>(emptyForm);
  const [message, setMessage] = useState('');

  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [agentForm, setAgentForm] = useState<SaveAiAgentRequest>(emptyAgentForm);
  const [agentMessage, setAgentMessage] = useState('');

  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [bridgeCopied, setBridgeCopied] = useState(false);
  useEffect(() => {
    getBridgeInfo().then(setBridge).catch(() => setBridge(null));
  }, []);
  const handleRegenerateToken = async () => {
    try {
      setBridge(await regenerateBridgeToken());
    } catch (e) {
      console.error('Token yenilenemedi:', e);
    }
  };
  const copyBridge = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setBridgeCopied(true);
      setTimeout(() => setBridgeCopied(false), 1500);
    } catch { /* pano erişimi yok */ }
  };

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
    <div className="view settings-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">Fraude Configuration</p>
          <h1>Settings</h1>
        </div>
        {account && (
          <div style={{ textAlign: 'right' }}>
            <p className="st-signed">
              {t('authSignedInAs')}: {account.name} · {account.email}
            </p>
            <button type="button" className="st-danger-btn" onClick={signOut}>
              {t('authSignOut')}
            </button>
          </div>
        )}
      </div>

      <div className="st-tabs" role="tablist">
        {([
          ['account', t('authAccount')],
          ['keys', 'AI Providers'],
          ['agents', 'AI Agents'],
          ['updates', t('updates')],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`st-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'account' && (
        <>
          <section className="panel">
            <h2>{t('authProfile')}</h2>
            {account ? (
              <div className="st-kv">
                <span className="k">{t('authName')}</span>
                <span>{account.name}</span>
                <span className="k">{t('authEmail')}</span>
                <span>{account.email}</span>
                <span className="k">{t('authMemberSince')}</span>
                <span>{new Date(account.createdAt).toLocaleDateString()}</span>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</p>
            )}
          </section>

          <section className="panel">
            <h2>GitHub Hesabı & Katkı Yetkisi</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 16px', lineHeight: '1.5' }}>
              Güncelleme ve modül katkılarınızı GitHub üzerinde kendi adınıza otomatik yayınlamak için hesabınızı veya Personal Access Token'ınızı bağlayabilirsiniz.
            </p>

            <div className="st-kv" style={{ marginBottom: '16px' }}>
              <span className="k">GitHub Durumu</span>
              <span>
                {ghUser ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                    <span className="st-pill" style={{ background: 'rgba(0,255,157,0.15)', color: '#00ff9d', border: '1px solid rgba(0,255,157,0.3)' }}>
                      ● Bağlı (@{ghUser})
                    </span>
                    <button
                      type="button"
                      onClick={handleDisconnectGh}
                      style={{ background: 'none', border: '1px solid rgba(255, 77, 77, 0.3)', color: '#ff4d4d', padding: '3px 10px', borderRadius: '6px', fontSize: '0.76rem', cursor: 'pointer' }}
                    >
                      Bağlantıyı Kes
                    </button>
                  </div>
                ) : (
                  <span className="st-pill" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
                    Bağlı Değil
                  </span>
                )}
              </span>
            </div>

            {!ghUser && (
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-main)', marginBottom: '8px', fontWeight: 600 }}>
                  👤 GitHub Kullanıcı Adınız İle Anında Bağlanın:
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    value={ghInput}
                    onChange={(e) => {
                      setGhInput(e.target.value);
                      setTokenError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleConnectUsername();
                    }}
                    placeholder="Örn: yazicmert"
                    style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}
                  />
                  <button
                    type="button"
                    disabled={userChecking || !ghInput.trim()}
                    style={{ padding: '8px 16px', background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', color: '#04140d', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => void handleConnectUsername()}
                  >
                    {userChecking ? 'Doğrulanıyor...' : ghSaved ? '✓ Bağlandı' : 'Doğrula & Bağla'}
                  </button>
                </div>
                {tokenError && (
                  <p style={{ fontSize: '0.76rem', color: '#ff4d4d', margin: '6px 0 0' }}>
                    ⚠ {tokenError}
                  </p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start', marginBottom: '16px' }}>
              <button
                type="button"
                className="st-btn"
                onClick={() => {
                  setShowTokenBox(true);
                  void openUrl('https://github.com/settings/tokens/new?description=FRAUDE+Terminal&scopes=public_repo,read:user');
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '10px 20px', background: '#24292e', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#ffffff', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}
              >
                <GithubIcon size={18} />
                <span>GitHub Sayfasında İzin Ver & Bağlan</span>
              </button>

              <button
                type="button"
                className="upd-link"
                onClick={() => setShowTokenBox((v) => !v)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                {showTokenBox ? '▴ Personal Access Token alanını gizle' : 'Token (PAT) ile manuel bağlayın ▾'}
              </button>
            </div>

            {showTokenBox && (
              <div style={{ marginTop: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', margin: 0 }}>
                    GitHub Personal Access Token (PAT)
                  </label>
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() => void openUrl('https://github.com/settings/tokens/new?description=FRAUDE+Terminal&scopes=public_repo')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'rgba(0, 255, 157, 0.12)', border: '1px solid #00ff9d', color: '#00ff9d', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    <span>🔑</span> GitHub'da Token Oluştur (Tek Tık)
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="password"
                    value={ghToken}
                    onChange={(e) => {
                      setGhToken(e.target.value);
                      setTokenError(null);
                    }}
                    placeholder="ghp_... veya github_pat_..."
                    autoFocus
                    style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    disabled={validatingToken}
                    style={{ padding: '8px 16px', background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', color: '#04140d', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => void handleSaveToken()}
                  >
                    {validatingToken ? 'Doğrulanıyor...' : ghSaved ? '✓ Bağlandı' : 'Kaydet & Bağla'}
                  </button>
                </div>
                {tokenError && (
                  <p style={{ fontSize: '0.76rem', color: '#ff4d4d', marginTop: '6px', margin: '6px 0 0' }}>
                    ⚠ {tokenError}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>{t('authLicense')}</h2>
            {license === 'loading' ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('authLicenseChecking')}</p>
            ) : license ? (
              <>
                <div className="st-kv">
                  <span className="k">{t('authLicenseStatus')}</span>
                  <span>
                    <span className="st-pill">{t('authLicenseActive')}</span>
                  </span>
                  <span className="k">{t('authLicensePlan')}</span>
                  <span style={{ textTransform: 'capitalize' }}>{license.plan}</span>
                  <span className="k">{t('authLicenseExpires')}</span>
                  <span>{license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : t('authLicenseNoExpiry')}</span>
                  {license.maxDevices > 0 && (
                    <>
                      <span className="k">{t('authLicenseDevices')}</span>
                      <span>{license.devices.length} / {license.maxDevices}</span>
                    </>
                  )}
                </div>
                {license.devices.length > 0 && (
                  <ul className="st-devices">
                    {license.devices.map((device, index) => (
                      <li key={device.device_id ?? index}>
                        <span>{device.device_name ?? t('authUnknownDevice')}</span>
                        {device.current && <span className="cur">● {t('authThisDevice')}</span>}
                        <span className="seen">{new Date(device.last_seen_at).toLocaleString()}</span>
                        {!device.current && device.device_id && (
                          <button
                            type="button"
                            className="st-device-drop"
                            disabled={releasing !== null}
                            onClick={() => dropDevice(device.device_id!)}
                          >
                            {releasing === device.device_id ? t('authWorking') : t('authReleaseDevice')}
                          </button>
                        )}
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
            <button type="button" className="st-danger-btn" onClick={signOut}>
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
              style={{ resize: 'vertical', minHeight: '100px' }}
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
          <button type="submit" className="primary-button" style={{ gridColumn: '1 / -1' }}>
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

      <section className="panel">
        <h2>🧩 {t('bridgeTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('bridgeDesc')}</p>
        {bridge ? (
          bridge.running ? (
            <div className="st-kv">
              <div><span>{t('bridgePort')}</span><strong>{bridge.port}</strong></div>
              <div>
                <span>{t('bridgeToken')}</span>
                <code style={{ fontSize: '0.8rem', wordBreak: 'break-all', background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: '4px' }}>{bridge.token}</code>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button type="button" onClick={() => copyBridge(`127.0.0.1:${bridge.port}`)}>
                  {bridgeCopied ? t('bridgeCopied') : t('bridgeCopyAddress')}
                </button>
                <button type="button" onClick={() => copyBridge(bridge.token)}>
                  {t('bridgeCopyToken')}
                </button>
                <button type="button" className="st-danger-btn" onClick={handleRegenerateToken}>
                  {t('bridgeRegenerate')}
                </button>
              </div>
              <p className="muted" style={{ marginTop: '12px', fontSize: '0.82rem' }}>{t('bridgeHint')}</p>
            </div>
          ) : (
            <p className="muted">{t('bridgeNotRunning')}</p>
          )
        ) : (
          <p className="muted">{t('bridgeUnavailable')}</p>
        )}
      </section>
        </>
      )}

      {activeTab === 'updates' && <UpdatesView />}
    </div>
  );
}
