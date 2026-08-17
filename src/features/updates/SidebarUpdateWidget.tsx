import { useAppUpdateChecker } from './useAppUpdateChecker';
import { formatBytes } from './appUpdaterEngine';
import { useTranslation } from '../../api/i18n';
import { Download, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import './SidebarUpdateWidget.css';

interface SidebarUpdateWidgetProps {
  onOpenUpdatesTab: () => void;
}

export default function SidebarUpdateWidget({ onOpenUpdatesTab }: SidebarUpdateWidgetProps) {
  const { t } = useTranslation();
  const {
    hasUpdate,
    latestVersion,
    currentVersion,
    isChecking,
    downloadProgress,
    checkForUpdates,
    startInAppUpdate,
  } = useAppUpdateChecker();

  const isDownloading = downloadProgress.status === 'downloading' || downloadProgress.status === 'verifying';
  const isCompleted = downloadProgress.status === 'completed';

  if (hasUpdate && latestVersion) {
    return (
      <div className="sidebar-update-card">
        <div className="sidebar-update-top">
          <div className="sidebar-update-badge">
            <Sparkles size={12} className="sparkle-icon" />
            <span>v{latestVersion} {t('updNewVersionBadge') || 'YENİ'}</span>
          </div>
          <button
            type="button"
            className="sidebar-update-link"
            onClick={onOpenUpdatesTab}
            title={t('updViewDetails') || 'Detaylar'}
          >
            ↗
          </button>
        </div>

        {isDownloading ? (
          <div className="sidebar-update-progress">
            <div className="sidebar-update-progress-labels">
              <span>{downloadProgress.status === 'verifying' ? (t('updVerifying') || 'Doğrulanıyor') : `%${downloadProgress.percentage}`}</span>
              <span>{formatBytes(downloadProgress.loadedBytes)} / {formatBytes(downloadProgress.totalBytes)}</span>
            </div>
            <div className="sidebar-update-progress-bar">
              <div
                className="sidebar-update-progress-fill"
                style={{ width: `${downloadProgress.percentage}%` }}
              />
            </div>
          </div>
        ) : isCompleted ? (
          <button
            type="button"
            className="sidebar-update-btn success"
            onClick={startInAppUpdate}
          >
            <CheckCircle2 size={13} />
            <span>{t('updReinstallBtn') || 'Başlat'}</span>
          </button>
        ) : (
          <button
            type="button"
            className="sidebar-update-btn primary"
            onClick={startInAppUpdate}
          >
            <Download size={13} />
            <span>{t('updDirectBtn') || 'Güncelle'}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="sidebar-version-footer">
      <div className="sidebar-version-info">
        <span className="sidebar-version-dot" />
        <span className="sidebar-version-text">v{currentVersion}</span>
      </div>
      <button
        type="button"
        className={`sidebar-check-btn${isChecking ? ' checking' : ''}`}
        onClick={() => void checkForUpdates(true)}
        title={t('updCheck') || 'Güncellemeleri Denetle'}
        disabled={isChecking}
      >
        <RefreshCw size={12} className={isChecking ? 'spin-icon' : ''} />
      </button>
    </div>
  );
}
