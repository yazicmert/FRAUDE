// Forum yazma kutularında $ ile hisse anma tamamlaması.
//
// Kullanıcı gövdeye "$" yazdığı anda liste açılır ve yazılan her harfte BIST
// evreninde hem koda hem şirket adına göre süzülür. Seçim, yarım anmayı
// gövdede geçerli koda çevirir; böylece extractTickers gönderiyi kendiliğinden
// etiketler.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { getDashboardSnapshot } from '../../api/tauriClient';
import { normalizeSearch } from '../../components/symbolCatalog';
import { findMentionDraft, type MentionDraft } from './forumApi';

export interface MentionItem {
  ticker: string;
  name: string;
}

/** Aynı anda birden çok kutu açık olabilir (konu + yanıtlar); evren tek sefer çekilir. */
let universeRequest: Promise<MentionItem[]> | null = null;
/** Başarısız denemeden sonra beklenecek süre; her harfte yeniden çağrılmasın diye. */
const RETRY_COOLDOWN_MS = 30_000;
let retryAfter = 0;

export function loadTickerUniverse(): Promise<MentionItem[]> {
  if (!universeRequest) {
    if (Date.now() < retryAfter) return Promise.resolve([]);
    universeRequest = getDashboardSnapshot()
      .then((snap) => (snap?.equities ?? []).map((e) => ({ ticker: e.ticker, name: e.name })))
      .catch(() => {
        // Veri gelmezse elle yazmak yine çalışır; bir süre sonra yeniden denenir.
        universeRequest = null;
        retryAfter = Date.now() + RETRY_COOLDOWN_MS;
        return [];
      });
  }
  return universeRequest;
}

const MENTION_LIMIT = 8;

export interface TickerMention {
  /** Liste çizilecek mi. */
  open: boolean;
  items: MentionItem[];
  activeIndex: number;
  /** Textarea'nın onChange/onSelect/onClick akışından çağrılır. */
  sync: (element: HTMLTextAreaElement | null) => void;
  /** Liste açıkken tuşu tüketir; tükettiyse true döner. */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  accept: (item: MentionItem) => void;
  close: () => void;
}

/**
 * @param setValue Gövdeyi güncelleyen setter; seçim yapıldığında çağrılır.
 * @param ref Anmanın yazıldığı textarea (imleç konumu buradan okunur).
 */
export function useTickerMention(
  setValue: (next: string) => void,
  ref: RefObject<HTMLTextAreaElement | null>,
): TickerMention {
  const [universe, setUniverse] = useState<MentionItem[]>([]);
  const [draft, setDraft] = useState<MentionDraft | null>(null);
  const [highlight, setHighlight] = useState(0);
  /** Esc ile kapatılan anmanın başlangıcı; imleç oradan ayrılınca temizlenir. */
  const dismissedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!draft || universe.length > 0) return;
    let cancelled = false;
    void loadTickerUniverse().then((rows) => {
      if (!cancelled) setUniverse(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, universe.length]);

  const sync = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) {
      setDraft(null);
      return;
    }
    const next = findMentionDraft(element.value, element.selectionStart ?? 0);
    if (!next) {
      dismissedAt.current = null;
      setDraft(null);
      return;
    }
    if (dismissedAt.current !== null && dismissedAt.current !== next.start) dismissedAt.current = null;
    if (dismissedAt.current === next.start) {
      setDraft(null);
      return;
    }
    setDraft((current) => {
      if (current && current.start === next.start && current.end === next.end && current.query === next.query) {
        return current;
      }
      return next;
    });
    setHighlight(0);
  }, []);

  const items = useMemo(() => {
    if (!draft || universe.length === 0) return [];
    const query = normalizeSearch(draft.query);
    const scored: { row: MentionItem; score: number }[] = [];
    for (const row of universe) {
      const ticker = normalizeSearch(row.ticker);
      const name = normalizeSearch(row.name);
      // Sırayla: kod başlangıcı, ad başlangıcı, herhangi bir yerde geçmesi.
      const score = !query
        ? 3
        : ticker.startsWith(query)
          ? 0
          : name.startsWith(query)
            ? 1
            : ticker.includes(query) || name.includes(query)
              ? 2
              : -1;
      if (score >= 0) scored.push({ row, score });
    }
    scored.sort((a, b) => a.score - b.score || a.row.ticker.localeCompare(b.row.ticker, 'tr'));
    return scored.slice(0, MENTION_LIMIT).map((entry) => entry.row);
  }, [draft, universe]);

  const activeIndex = items.length === 0 ? 0 : Math.min(highlight, items.length - 1);
  const open = draft !== null && items.length > 0;

  const close = useCallback(() => {
    setDraft(null);
    setHighlight(0);
  }, []);

  const accept = useCallback(
    (item: MentionItem) => {
      const element = ref.current;
      if (!draft || !element) return;
      const source = element.value;
      // Yarım anmayı geçerli kodla değiştirip peşine boşluk koyar; imleç oraya gider.
      const next = `${source.slice(0, draft.start)}${draft.sigil}${item.ticker} ${source.slice(draft.end)}`;
      const caret = draft.start + draft.sigil.length + item.ticker.length + 1;
      close();
      dismissedAt.current = null;
      setValue(next);
      window.requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(caret, caret);
      });
    },
    [draft, ref, setValue, close],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        accept(items[activeIndex]);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissedAt.current = draft?.start ?? null;
        close();
        return true;
      }
      return false;
    },
    [open, items, activeIndex, accept, close, draft],
  );

  return { open, items, activeIndex, sync, handleKeyDown, accept, close };
}
