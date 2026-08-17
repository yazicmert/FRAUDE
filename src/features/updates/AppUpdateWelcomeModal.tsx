import { Sparkles, Download, RefreshCw, X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAppUpdateChecker } from './useAppUpdateChecker';
import { restartApp } from '../../api/tauriClient';
import { formatBytes } from './appUpdaterEngine';

interface AppUpdateWelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AppUpdateWelcomeModal({
  isOpen,
  onClose,
}: AppUpdateWelcomeModalProps) {
  const {
    checkResult,
    downloadProgress,
    startInAppUpdate,
  } = useAppUpdateChecker();

  if (!isOpen || !checkResult || !checkResult.hasUpdate) {
    return null;
  }

  const latestVer = checkResult.latestVersion;
  const currentVer = checkResult.currentVersion;
  const releaseTitle = checkResult.releaseTitle || `v${latestVer}`;
  const releaseNotes = checkResult.releaseNotes || '';

  const handleStartUpdate = async () => {
    await startInAppUpdate();
  };

  const handleRestart = async () => {
    try {
      await restartApp();
    } catch {
      window.location.reload();
    }
  };

  const isDownloading = downloadProgress.status === 'downloading' || downloadProgress.status === 'verifying';
  const isCompleted = downloadProgress.status === 'completed';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 11000,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={!isDownloading ? onClose : undefined}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          background: '#161b22',
          border: '1px solid rgba(63, 185, 80, 0.4)',
          borderRadius: '10px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8), 0 0 20px rgba(63, 185, 80, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeIn 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            background: 'linear-gradient(180deg, rgba(35, 134, 54, 0.25) 0%, rgba(22, 27, 34, 0.95) 100%)',
            borderBottom: '1px solid #30363d',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(63, 185, 80, 0.2)',
                border: '1px solid #3fb950',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3fb950',
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Yeni FRAUDE Sürümü Mevcut!
                <span
                  style={{
                    background: '#238636',
                    color: '#fff',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  v{latestVer}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: '2px' }}>
                Mevcut: v{currentVer} → Yeni: v{latestVer}
              </div>
            </div>
          </div>

          {!isDownloading && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b949e',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Release Notes Summary */}
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#c9d1d9', marginBottom: '6px' }}>
              {releaseTitle}
            </div>
            <div
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                background: '#0d1117',
                border: '1px solid #21262d',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '0.76rem',
                color: '#8b949e',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {releaseNotes || 'Bu sürüm ile birlikte performans iyileştirmeleri, grafik çizim araçları ve bulut alarmları eklendi.'}
            </div>
          </div>

          {/* İndirme Durumu ve İlerleme Çubuğu */}
          {isDownloading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>
                  {downloadProgress.status === 'verifying' ? 'Paket doğrulanıyor...' : 'Güncelleme paketi indiriliyor...'}
                </span>
                <span style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  %{downloadProgress.percentage} ({formatBytes(downloadProgress.loadedBytes)} / {formatBytes(downloadProgress.totalBytes)})
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  background: '#21262d',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${downloadProgress.percentage}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #238636 0%, #3fb950 100%)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Tamamlandı Durumu */}
          {isCompleted && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(63, 185, 80, 0.12)',
                border: '1px solid rgba(63, 185, 80, 0.3)',
                padding: '12px 14px',
                borderRadius: '6px',
                color: '#3fb950',
                fontSize: '0.8rem',
                fontWeight: 'bold',
              }}
            >
              <CheckCircle2 size={20} />
              <span>Güncelleme paketi başarıyla indirildi. Yeniden başlatmaya hazır!</span>
            </div>
          )}

          {/* Hata Durumu */}
          {downloadProgress.status === 'error' && (
            <div
              style={{
                background: 'rgba(248, 81, 73, 0.12)',
                border: '1px solid rgba(248, 81, 73, 0.3)',
                padding: '10px 14px',
                borderRadius: '6px',
                color: '#f85149',
                fontSize: '0.78rem',
              }}
            >
              {downloadProgress.error || 'İndirme sırasında hata oluştu. Tarayıcıdan indirmeyi deneyin.'}
            </div>
          )}

          {/* Aksiyon Butonları */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            {!isDownloading && !isCompleted && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '9px 14px',
                  background: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                Daha Sonra Hatırlat
              </button>
            )}

            {isCompleted ? (
              <button
                type="button"
                onClick={handleRestart}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 18px',
                  background: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: 'bold',
                  boxShadow: '0 0 12px rgba(63, 185, 80, 0.4)',
                }}
              >
                <RefreshCw size={15} /> Uygulamayı Kapat ve Yeniden Başlat
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartUpdate}
                disabled={isDownloading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 18px',
                  background: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isDownloading ? 'not-allowed' : 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: 'bold',
                  boxShadow: '0 0 12px rgba(63, 185, 80, 0.4)',
                  opacity: isDownloading ? 0.7 : 1,
                }}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw size={15} className="spin" /> İndiriliyor...
                  </>
                ) : (
                  <>
                    <Download size={15} /> Şimdi Güncelle ve Yeniden Başlat <ArrowRight size={14} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
