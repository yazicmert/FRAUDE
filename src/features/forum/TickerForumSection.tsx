import { useTranslation } from '../../api/i18n';
import { dispatchOpenForum } from '../../lib/actions';
import ForumFeed from './ForumFeed';
import './Forum.css';

interface Props {
  ticker: string;
  onSelectTicker?: (ticker: string) => void;
}

/**
 * Hisse sayfasındaki forum bölümü. Modül görünümüyle aynı akışa bakar; tek
 * fark, yalnız bu hisseyi etiketleyen gönderileri göstermesi ve yazma
 * kutusunun etiketi kendiliğinden eklemesidir.
 */
export default function TickerForumSection({ ticker, onSelectTicker }: Props) {
  const { t } = useTranslation();

  return (
    <section className="panel frm-section" style={{ marginTop: '16px' }}>
      <div className="frm-section-head">
        <div>
          <h2>{t('forum')} · {ticker}</h2>
          <span>{t('forumTickerSectionSub')}</span>
        </div>
        <button type="button" className="small-button" onClick={() => dispatchOpenForum(ticker)}>
          {t('forumOpenModule')}
        </button>
      </div>

      <ForumFeed
        ticker={ticker}
        pageSize={5}
        compact
        onSelectTicker={onSelectTicker}
        emptyText={t('forumEmptyTicker', { ticker })}
        composerPlaceholder={t('forumComposerTickerPlaceholder', { ticker })}
      />
    </section>
  );
}
