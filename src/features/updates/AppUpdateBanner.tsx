import { useAppUpdateChecker } from './useAppUpdateChecker';
import { formatBytes } from './appUpdaterEngine';
import { useTranslation } from '../../api/i18n';
import { Sparkles, Download, CheckCircle2, X, ArrowUpRight, AlertCircle, RefreshCw } from 'lucide-react';
import './AppUpdateBanner.css';

interface AppUpdateBannerProps {
  onOpenUpdatesTab: () => void;
}

export default function AppUpdateBanner({ onOpenUpdatesTab }: AppUpdateBannerProps) {
  const { t } = useTranslation();
  const {
    hasUpdate,
    latestVersion,
    currentVersion,
    checkResult,
    downloadProgress,
    isBannerDismissed,
    startInAppUpdate,
    dismissBanner,
  } = useAppUpdateChecker();

  if (!hasUpdate || isBannerDismissed) {
    return null;
  }

  const isDownloading = downloadProgress.status === 'downloading' || downloadProgress.status === 'verifying';
  const isCompleted = downloadProgress.status === 'completed';
  const isError = downloadProgress.status === 'error';

  return (
    <aside
      aria-label={t('updateAvailable')}
      className="app-update-banner"
    >
      {/* Kapat Butonu */}
      <button
        type="button"
        className="app-update-close"
        onClick={dismissBanner}
        title={t('close') || 'Kapat'}
      >
        <X size={14} />
      </button>

      {/* Üst Başlık & Rozet */}
      <div className="app-update-header">
        <div className="app-update-badge">
          <Sparkles size={13} className="sparkle-icon" />
          <span>{t('updNewVersionBadge') || 'YENİ SÜRÜM'}</span>
        </div>
        <div className="app-update-version-tag">
          v{currentVersion} → <strong>v{latestVersion}</strong>
        </div>
      </div>

      {/* Başlık ve Özet */}
      <div className="app-update-content">
        <div className="app-update-title">
          {checkResult?.releaseTitle || `FRAUDE Terminal v${latestVersion}`}
        </div>
        <p className="app-update-summary">
          {checkResult?.releaseNotes
            ? checkResult.releaseNotes.slice(0, 110) + '...'
            : t('updDirectDesc') || 'Yeni özellikler, performans geliştirmeleri ve güvenlik güncellemeleri hazır.'}
        </p>
      </div>

      {/* İndirme İlerleme Durumu */}
      {isDownloading && (
        <div className="app-update-progress-container">
          <div className="app-update-progress-info">
            <span>
              {downloadProgress.status === 'verifying'
                ? t('updVerifying') || 'Doğrulanıyor...'
                : `${t('updDownloading') || 'İndiriliyor'} %${downloadProgress.percentage}`}
            </span>
            <span className="app-update-progress-bytes">
              {formatBytes(downloadProgress.loadedBytes)} / {formatBytes(downloadProgress.totalBytes)}
            </span>
          </div>
          <div className="app-update-progress-bar">
            <div
              className="app-update-progress-fill"
              style={{ width: `${downloadProgress.percentage}%` }}
            />
          </div>
          {downloadProgress.speedBytesPerSec > 0 && (
            <div className="app-update-speed">
              ⚡ {formatBytes(downloadProgress.speedBytesPerSec)}/s
            </div>
          )}
        </div>
      )}

      {/* Tamamlandı Durumu */}
      {isCompleted && (
        <div className="app-update-success-box">
          <CheckCircle2 size={15} color="#3fb950" />
          <span>{t('updDownloadedReady') || 'Kurulum dosyası hazırlandı ve başlatıldı!'}</span>
        </div>
      )}

      {/* Hata Durumu */}
      {isError && (
        <div className="app-update-error-box">
          <AlertCircle size={14} color="#f85149" />
          <span>{downloadProgress.error || 'İndirme hatası oluştu.'}</span>
        </div>
      )}

      {/* Aksiyon Butonları */}
      <div className="app-update-actions">
        {!isDownloading && !isCompleted && (
          <button
            type="button"
            className="app-update-btn-primary"
            onClick={startInAppUpdate}
          >
            <Download size={14} />
            <span>{t('updDirectBtn') || 'Uygulamadan Güncelle'}</span>
          </button>
        )}

        {isDownloading && (
          <button type="button" className="app-update-btn-primary" disabled>
            <RefreshCw size={14} className="spin-icon" />
            <span>{t('updDownloading') || 'İndiriliyor...'}</span>
          </button>
        )}

        {isCompleted && (
          <button
            type="button"
            className="app-update-btn-primary success"
            onClick={startInAppUpdate}
          >
            <CheckCircle2 size={14} />
            <span>{t('updReinstallBtn') || 'Tekrar Başlat'}</span>
          </button>
        )}

        <button
          type="button"
          className="app-update-btn-secondary"
          onClick={() => {
            onOpenUpdatesTab();
            dismissBanner();
          }}
        >
          <span>{t('updViewDetails') || 'Detaylar'}</span>
          <ArrowUpRight size={13} />
        </button>
      </div>
    </aside>
  );
}
