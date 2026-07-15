import { useState, useEffect } from 'react';

export interface WatchlistItem {
  ticker: string;
  addedAt: string;
  addedPrice: number;
  /** Adet; girilmemişse pozisyon eşit ağırlıklı kabul edilir. */
  quantity?: number;
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('fraude-watchlist');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && typeof parsed[0] === 'string') {
            // Migrate from string[] to WatchlistItem[]
            const migrated = parsed.map((ticker: string) => ({ ticker, addedAt: new Date().toISOString(), addedPrice: 0 }));
            setWatchlist(migrated);
            localStorage.setItem('fraude-watchlist', JSON.stringify(migrated));
          } else {
            setWatchlist(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to parse watchlist', e);
      }
    }
  }, []);

  const toggleWatchlist = (ticker: string, currentPrice: number = 0) => {
    setWatchlist(prev => {
      const exists = prev.some(item => item.ticker === ticker);
      const next = exists 
        ? prev.filter(item => item.ticker !== ticker)
        : [...prev, { ticker, addedAt: new Date().toISOString(), addedPrice: currentPrice }];
      localStorage.setItem('fraude-watchlist', JSON.stringify(next));
      // Dispatch event to sync across components
      window.dispatchEvent(new CustomEvent('fraude-watchlist-updated', { detail: next }));
      return next;
    });
  };

  const updateWatchlistItem = (ticker: string, patch: Partial<Pick<WatchlistItem, 'addedPrice' | 'quantity'>>) => {
    setWatchlist(prev => {
      const next = prev.map(item => item.ticker === ticker ? { ...item, ...patch } : item);
      localStorage.setItem('fraude-watchlist', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('fraude-watchlist-updated', { detail: next }));
      return next;
    });
  };

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<WatchlistItem[]>;
      setWatchlist(customEvent.detail);
    };
    window.addEventListener('fraude-watchlist-updated', handleUpdate);
    return () => window.removeEventListener('fraude-watchlist-updated', handleUpdate);
  }, []);

  return {
    watchlist,
    toggleWatchlist,
    updateWatchlistItem,
    isInWatchlist: (ticker: string) => watchlist.some(item => item.ticker === ticker),
    getWatchlistItem: (ticker: string) => watchlist.find(item => item.ticker === ticker),
  };
}
