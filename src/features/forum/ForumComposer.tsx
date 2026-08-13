import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { getSession } from '../auth/session';
import { normalizeSearch } from '../../components/symbolCatalog';
import { loadTickerUniverse, useTickerMention } from './useTickerMention';
import {
  createPost,
  forumErrorKey,
  extractTickers,
  isValidTicker,
  normalizeTicker,
  MAX_BODY_LENGTH,
  MAX_TICKERS,
  type ForumPost,
} from './forumApi';

interface Props {
  /** Dolu ise gönderi bu kök konunun yanıtı olur. */
  parentId?: string | null;
  /** Bağlamdan gelen, kaldırılamayan etiketler (hisse sayfası forumu). */
  presetTickers?: string[];
  placeholder?: string;
  submitLabel?: string;
  compact?: boolean;
  autoFocus?: boolean;
  onPosted: (post: ForumPost) => void;
  onCancel?: () => void;
}

/**
 * Forum yazma kutusu. Etiketler iki yoldan gelir: gövdeye yazılan $KOD
 * anmaları (kendiliğinden yakalanır) ve etiket kutusundan seçilenler.
 * İkisinin birleşimi gönderilir; son söz sunucudaki normalleştirmededir.
 */
export default function ForumComposer({
  parentId = null,
  presetTickers = [],
  placeholder,
  submitLabel,
  compact = false,
  autoFocus = false,
  onPosted,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const session = getSession();
  const [body, setBody] = useState('');
  const [manualTickers, setManualTickers] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [universe, setUniverse] = useState<{ ticker: string; name: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useTickerMention(setBody, textareaRef);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Etiket önerileri BIST evreninden; veri gelmezse elle giriş yine çalışır
  // (NotificationsView ile aynı desen).
  useEffect(() => {
    if (!tagOpen || universe.length > 0) return;
    let cancelled = false;
    void loadTickerUniverse().then((rows) => {
      if (!cancelled) setUniverse(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [tagOpen, universe.length]);

  const preset = useMemo(
    () => Array.from(new Set(presetTickers.map(normalizeTicker).filter(isValidTicker))),
    [presetTickers],
  );
  const detected = useMemo(() => extractTickers(body), [body]);
  const tickers = useMemo(
    () => Array.from(new Set([...preset, ...manualTickers, ...detected])).slice(0, MAX_TICKERS),
    [preset, manualTickers, detected],
  );

  const suggestions = useMemo(() => {
    const query = normalizeSearch(tagDraft.trim());
    if (query.length < 1 || universe.length === 0) return [];
    return universe
      .filter((row) => normalizeSearch(row.ticker).includes(query) || normalizeSearch(row.name).includes(query))
      .filter((row) => !tickers.includes(row.ticker.toUpperCase()))
      .slice(0, 6);
  }, [tagDraft, universe, tickers]);

  const addTag = (raw: string) => {
    const symbol = normalizeTicker(raw);
    if (!isValidTicker(symbol) || tickers.includes(symbol) || tickers.length >= MAX_TICKERS) {
      setTagDraft('');
      return;
    }
    setManualTickers((current) => [...current, symbol]);
    setTagDraft('');
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const post = await createPost({ body: trimmed, tickers, parentId });
      setBody('');
      setManualTickers([]);
      setTagDraft('');
      setTagOpen(false);
      onPosted(post);
    } catch (err) {
      setError(t(forumErrorKey(err)));
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return <div className="frm-note">{t('forumNeedsLogin')}</div>;
  }

  const remaining = MAX_BODY_LENGTH - body.length;

  return (
    <div className={`frm-composer${compact ? ' compact' : ''}`}>
      <div className="frm-input-wrap">
        <textarea
          ref={textareaRef}
          className="frm-input"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          placeholder={placeholder ?? t('forumComposerPlaceholder')}
          rows={compact ? 2 : 3}
          onChange={(event) => {
            setBody(event.target.value);
            mention.sync(event.target);
          }}
          onSelect={(event) => mention.sync(event.currentTarget)}
          onBlur={() => mention.close()}
          onKeyDown={(event) => {
            // ⌘/Ctrl + Enter her zaman gönderir; anma listesi yalnız yalın tuşları yer.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
              return;
            }
            mention.handleKeyDown(event);
          }}
        />
        {mention.open && (
          <ul className="frm-suggest frm-mention">
            {mention.items.map((row, index) => (
              <li
                key={row.ticker}
                className={index === mention.activeIndex ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  mention.accept(row);
                }}
              >
                <strong>${row.ticker}</strong>
                <span>{row.name}</span>
              </li>
            ))}
            <li className="frm-mention-hint">{t('forumMentionHint')}</li>
          </ul>
        )}
      </div>

      <div className="frm-composer-tags">
        {tickers.map((symbol) => {
          const locked = preset.includes(symbol) || detected.includes(symbol);
          return (
            <span key={symbol} className={`frm-tag${locked ? ' locked' : ''}`}>
              {symbol}
              {locked ? (
                <em title={preset.includes(symbol) ? t('forumTagContext') : t('forumTagAuto')}>
                  {preset.includes(symbol) ? '•' : '$'}
                </em>
              ) : (
                <button type="button" onClick={() => setManualTickers((c) => c.filter((x) => x !== symbol))}>
                  ×
                </button>
              )}
            </span>
          );
        })}

        {tagOpen ? (
          <span className="frm-tag-input">
            <input
              autoFocus
              value={tagDraft}
              placeholder={t('forumTagPlaceholder')}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={() => window.setTimeout(() => setTagOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTag(suggestions[0]?.ticker ?? tagDraft);
                } else if (event.key === 'Escape') {
                  setTagOpen(false);
                  setTagDraft('');
                }
              }}
            />
            {suggestions.length > 0 && (
              <ul className="frm-suggest">
                {suggestions.map((row) => (
                  <li key={row.ticker} onMouseDown={() => addTag(row.ticker)}>
                    <strong>{row.ticker}</strong>
                    <span>{row.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </span>
        ) : (
          tickers.length < MAX_TICKERS && (
            <button type="button" className="frm-tag-add" onClick={() => setTagOpen(true)}>
              + {t('forumTagAdd')}
            </button>
          )
        )}
      </div>

      {error && <div className="frm-error">{error}</div>}

      <div className="frm-composer-foot">
        <span className="frm-hint">
          {remaining < 400 ? `${remaining}` : t('forumComposerHint')}
        </span>
        <div className="frm-composer-actions">
          {onCancel && (
            <button type="button" className="small-button" onClick={onCancel}>
              {t('forumCancel')}
            </button>
          )}
          <button
            type="button"
            className="frm-send"
            disabled={sending || body.trim().length === 0}
            onClick={() => void submit()}
          >
            {sending ? t('forumPosting') : (submitLabel ?? t('forumPost'))}
          </button>
        </div>
      </div>
    </div>
  );
}
