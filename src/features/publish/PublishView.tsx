import { useEffect, useState } from 'react';
import { invokePlatform as invoke } from '../../api/platformClient';
import { isDesktopRuntime } from '../../api/platformClient';
import { releaseSigningPayload, sha256Hex } from '../../modules/crypto';
import type { ModuleRelease } from '../../modules/types';
import { useTranslation } from '../../api/i18n';
import './PublishView.css';

// Masaüstü admin "Yayınla" paneli.
//
// Akış (güvenli): panel release'i kurar, artifact SHA-256'sını hesaplar ve
// kanonik imza payload'ını istemcinin BİREBİR kodu (crypto.ts `releaseSigningPayload`
// = `stableValue` + JSON.stringify) ile üretir; ardından Rust komutu
// `publish_module_release` bu kanonik baytları YEREL anahtarla imzalar ve admin
// token'ıyla registry'ye POST eder. Özel anahtar/token webview'e hiç girmez.

interface ConfigStatus {
  configured: boolean;
  keyPresent: boolean;
  publishUrl?: string | null;
  publicBaseUrl?: string | null;
  keyId: string;
  reason?: string | null;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const DEFAULT_CONTENT = JSON.stringify(
  { title: 'Örnek içerik', summary: 'Yayınla ile gönderilen imzalı deklaratif içerik.' },
  null,
  2,
);

export default function PublishView() {
  const { t } = useTranslation();
  const desktop = isDesktopRuntime();
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [moduleId, setModuleId] = useState('fraude.news');
  const [version, setVersion] = useState('0.1.2');
  const [channel, setChannel] = useState('official');
  const [nameTr, setNameTr] = useState('Haber Akışı');
  const [nameEn, setNameEn] = useState('News Feed');
  const [notesTr, setNotesTr] = useState('İçerik güncellemesi.');
  const [notesEn, setNotesEn] = useState('Content update.');
  const [content, setContent] = useState(DEFAULT_CONTENT);

  useEffect(() => {
    if (!desktop) return;
    invoke<ConfigStatus>('publish_config_status')
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, [desktop]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      JSON.parse(content); // geçersiz JSON'u erken yakala
      const base = (status?.publicBaseUrl ?? '').replace(/\/$/, '');
      const segment = moduleId.split('.').pop() || 'module';
      const path = `views/${segment}.json`;

      const artifactObject = {
        schemaVersion: 1,
        moduleId,
        version,
        runtime: { kind: 'declarative-v1' },
        files: [{ path, mediaType: 'application/json', content }],
      };
      const artifactBytes = new TextEncoder().encode(JSON.stringify(artifactObject));
      const sha256 = await sha256Hex(artifactBytes.buffer as ArrayBuffer);
      const artifactBase64 = encodeBase64(artifactBytes);

      const unsignedRelease = {
        manifest: {
          schemaVersion: 1,
          id: moduleId,
          version,
          name: { tr: nameTr, en: nameEn },
          description: { tr: notesTr, en: notesEn },
          kind: 'workspace',
          channel,
          targets: ['web', 'desktop'],
          compatibility: { fraude: '>=0.1.0 <1.0.0' },
          permissions: ['storage:workspace'],
          navigation: { tabKind: segment, titleKey: segment },
          artifact: {
            sha256,
            url: `${base}/v1/artifacts/${sha256}`,
            sizeBytes: artifactBytes.byteLength,
          },
        },
        baseArtifactHash: `embedded:${moduleId}@0.1.0`,
        changes: [{ path, kind: 'modify', summary: { tr: notesTr, en: notesEn } }],
        releaseNotes: { tr: notesTr, en: notesEn },
      };

      // İstemci ile birebir kanonik imza payload'ı.
      const canonicalPayload = releaseSigningPayload(unsignedRelease as unknown as ModuleRelease);

      const receipt = await invoke<{ published?: Record<string, string> }>('publish_module_release', {
        unsignedRelease,
        artifactBase64,
        canonicalPayload,
      });
      const p = receipt.published;
      setResult(p ? `Yayınlandı: ${p.id}@${p.version} (kanal ${p.channel})` : JSON.stringify(receipt));
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="publish-view">
      <div className="publish-inner">
        <p className="publish-eyebrow">{t('publish')}</p>
        <h1 className="publish-h1">Modül sürümü yayınla</h1>
        <p className="publish-sub">
          Yerelde imzala → registry'ye gönder. İmza anahtarın ve admin token'ın yalnız bu makinede
          kalır; web ve masaüstü kullanıcıları güncellemeyi pinlenmiş anahtarla doğrulayıp alır.
        </p>

        {!desktop ? (
          <div className="publish-note">
            Yayınlama yalnızca <b>masaüstü admin uygulamasında</b> kullanılabilir; web panelinde özel
            imza anahtarı bulunmaz.
          </div>
        ) : status && !status.configured ? (
          <div className="publish-note">
            Yayın yapılandırılmamış: <b>{status.reason}</b>.
            <br />
            <code>~/.config/fraude/registry-publish.json</code> içine <code>publishUrl</code>,{' '}
            <code>adminToken</code>, <code>publicBaseUrl</code> ekle ve{' '}
            <code>registry-signing-key.json</code> imza anahtarını yerleştir (
            <code>scripts/registry-build.mjs</code> üretir).
          </div>
        ) : (
          <>
            <div className="publish-status">
              <span className={`publish-badge ${status?.configured ? 'ok' : 'warn'}`}>
                {status?.configured ? 'HAZIR' : '…'}
              </span>
              <span className="kv">hedef: <b>{status?.publishUrl ?? '—'}</b></span>
              <span className="kv">anahtar: <b>{status?.keyId ?? '—'}</b></span>
            </div>

            <div className="publish-form">
              <div className="publish-row">
                <div className="publish-field">
                  <label>Modül kimliği</label>
                  <input value={moduleId} onChange={(e) => setModuleId(e.target.value)} />
                </div>
                <div className="publish-field">
                  <label>Sürüm</label>
                  <input value={version} onChange={(e) => setVersion(e.target.value)} />
                </div>
              </div>
              <div className="publish-row">
                <div className="publish-field">
                  <label>Kanal</label>
                  <input value={channel} onChange={(e) => setChannel(e.target.value)} />
                </div>
                <div className="publish-field">
                  <label>Ad (TR / EN)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={nameTr} onChange={(e) => setNameTr(e.target.value)} />
                    <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="publish-row">
                <div className="publish-field">
                  <label>Sürüm notu (TR)</label>
                  <input value={notesTr} onChange={(e) => setNotesTr(e.target.value)} />
                </div>
                <div className="publish-field">
                  <label>Release note (EN)</label>
                  <input value={notesEn} onChange={(e) => setNotesEn(e.target.value)} />
                </div>
              </div>
              <div className="publish-field">
                <label>İçerik (declarative JSON)</label>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
              </div>

              <div className="publish-actions">
                <button
                  type="button"
                  className="publish-btn"
                  disabled={busy || !status?.configured}
                  onClick={() => void publish()}
                >
                  {busy ? 'Yayınlanıyor…' : 'Yayınla'}
                </button>
              </div>

              {result && <div className="publish-result">{result}</div>}
              {error && <div className="publish-error">{error}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
