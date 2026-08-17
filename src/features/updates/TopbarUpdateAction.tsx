import { useState } from 'react';
import { Sparkles, RefreshCw, Check } from 'lucide-react';
import { useAppUpdateChecker } from './useAppUpdateChecker';
import AppUpdateWelcomeModal from './AppUpdateWelcomeModal';
import HotkeyTip from '../../components/HotkeyTip';

interface TopbarUpdateActionProps {
  onOpenUpdatesTab?: () => void;
}

export default function TopbarUpdateAction({ onOpenUpdatesTab }: TopbarUpdateActionProps) {
  const {
    hasUpdate,
    latestVersion,
    currentVersion,
    isChecking,
    checkForUpdates,
  } = useAppUpdateChecker();

  const [modalOpen, setModalOpen] = useState(false);
  const [justChecked, setJustChecked] = useState(false);

  const handleClick = async () => {
    if (hasUpdate) {
      setModalOpen(true);
      return;
    }

    // Güncelleme yoksa manuel kontrol tetikle
    const result = await checkForUpdates(true);
    if (result.hasUpdate) {
      setModalOpen(true);
    } else {
      setJustChecked(true);
      setTimeout(() => setJustChecked(false), 2000);
      if (onOpenUpdatesTab) {
        onOpenUpdatesTab();
      }
    }
  };

  const tooltipLabel = hasUpdate
    ? `✨ Yeni Sürüm Mevcut: v${latestVersion} (Tıklayın ve Güncelleyin)`
    : justChecked
    ? `✓ Sürüm Güncel (v${currentVersion})`
    : `FRAUDE v${currentVersion} · Güncellemeleri Denetle`;

  return (
    <>
      <HotkeyTip label={tooltipLabel}>
        <button
          type="button"
          onClick={handleClick}
          className={`topbar-icon-btn${hasUpdate ? ' topbar-update-active' : ''}`}
          style={{
            position: 'relative',
            color: hasUpdate ? '#3fb950' : '#8b949e',
            background: hasUpdate ? 'rgba(35, 134, 54, 0.2)' : 'transparent',
            border: hasUpdate ? '1px solid rgba(63, 185, 80, 0.4)' : '1px solid transparent',
            borderRadius: '6px',
            transition: 'all 0.2s ease',
          }}
        >
          {isChecking ? (
            <RefreshCw size={14} className="spin" />
          ) : hasUpdate ? (
            <Sparkles size={14} color="#3fb950" />
          ) : justChecked ? (
            <Check size={14} color="#3fb950" />
          ) : (
            <Sparkles size={14} />
          )}

          {/* Yeni güncelleme varsa yeşil nabız noktası */}
          {hasUpdate && (
            <span
              style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#3fb950',
                boxShadow: '0 0 6px #3fb950',
              }}
            />
          )}
        </button>
      </HotkeyTip>

      <AppUpdateWelcomeModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
