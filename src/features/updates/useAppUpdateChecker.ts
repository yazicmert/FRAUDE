import { useState, useEffect, useCallback, useRef } from 'react';
import {
  checkApplicationUpdate,
  startDirectDownload,
  type CheckUpdateResult,
  type DownloadProgress,
} from './appUpdaterEngine';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 dakika
const DISMISSED_VERSION_KEY = 'fraude-dismissed-update-version';

const DEFAULT_PROGRESS: DownloadProgress = {
  status: 'idle',
  percentage: 0,
  loadedBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
};

let globalCheckResult: CheckUpdateResult | null = null;
let globalProgress: DownloadProgress = DEFAULT_PROGRESS;

export function useAppUpdateChecker() {
  const [checkResult, setCheckResult] = useState<CheckUpdateResult | null>(globalCheckResult);
  const [isChecking, setIsChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>(globalProgress);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const isCheckingRef = useRef(false);

  const updateProgress = useCallback((next: DownloadProgress) => {
    globalProgress = next;
    setDownloadProgress(next);
    window.dispatchEvent(
      new CustomEvent('fraude-app-update-progress', { detail: next })
    );
  }, []);

  const checkForUpdates = useCallback(async (force = false): Promise<CheckUpdateResult> => {
    if (isCheckingRef.current) {
      return globalCheckResult || (await checkApplicationUpdate());
    }

    isCheckingRef.current = true;
    setIsChecking(true);

    try {
      const result = await checkApplicationUpdate();
      globalCheckResult = result;
      setCheckResult(result);
      setLastCheckedAt(new Date().toLocaleTimeString());

      const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
      if (dismissed === result.latestVersion && !force) {
        setIsBannerDismissed(true);
      } else {
        setIsBannerDismissed(false);
      }

      window.dispatchEvent(
        new CustomEvent('fraude-app-update-checked', { detail: result })
      );
      return result;
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, []);

  const startInAppUpdate = useCallback(async () => {
    const asset = checkResult?.asset;
    if (!asset || !asset.downloadUrl) {
      // Eğer doğrudan asset bulunamadıysa release sayfasına yönlendir
      if (checkResult?.htmlUrl) {
        window.open(checkResult.htmlUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    await startDirectDownload(asset.downloadUrl, asset.name, updateProgress);
  }, [checkResult, updateProgress]);

  const dismissBanner = useCallback(() => {
    if (checkResult?.latestVersion) {
      localStorage.setItem(DISMISSED_VERSION_KEY, checkResult.latestVersion);
    }
    setIsBannerDismissed(true);
  }, [checkResult]);

  // İlk yüklemede ve belirli aralıklarla arka planda denetle
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdates(false);
    }, 3000);

    const interval = setInterval(() => {
      void checkForUpdates(false);
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  // Global olayları dinle
  useEffect(() => {
    const handleProgressEvent = (e: Event) => {
      const customEvent = e as CustomEvent<DownloadProgress>;
      if (customEvent.detail) {
        setDownloadProgress(customEvent.detail);
      }
    };

    const handleCheckedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<CheckUpdateResult>;
      if (customEvent.detail) {
        setCheckResult(customEvent.detail);
      }
    };

    window.addEventListener('fraude-app-update-progress', handleProgressEvent);
    window.addEventListener('fraude-app-update-checked', handleCheckedEvent);

    return () => {
      window.removeEventListener('fraude-app-update-progress', handleProgressEvent);
      window.removeEventListener('fraude-app-update-checked', handleCheckedEvent);
    };
  }, []);

  return {
    checkResult,
    hasUpdate: Boolean(checkResult?.hasUpdate),
    latestVersion: checkResult?.latestVersion ?? null,
    currentVersion: checkResult?.currentVersion ?? '',
    isChecking,
    downloadProgress,
    isBannerDismissed,
    lastCheckedAt,
    checkForUpdates,
    startInAppUpdate,
    dismissBanner,
  };
}
