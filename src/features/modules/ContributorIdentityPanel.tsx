import { useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { getOrCreateDeviceIdentity, type StoredIdentity } from '../../modules/deviceIdentity';

export default function ContributorIdentityPanel() {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const prepareIdentity = async () => {
    setBusy(true);
    setError('');
    try {
      setIdentity(await getOrCreateDeviceIdentity());
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="contributor-identity-panel">
      <div>
        <strong>{t('contributorIdentity')}</strong>
        <small>{t('contributorIdentityDescription')}</small>
      </div>
      {identity ? (
        <code title={identity.id}>{identity.id.slice(0, 28)}…</code>
      ) : (
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void prepareIdentity()}>
          {busy ? t('preparingIdentity') : t('prepareIdentity')}
        </button>
      )}
      {error && <span className="negative">{error}</span>}
    </div>
  );
}
