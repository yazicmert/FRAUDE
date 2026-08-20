import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../features/auth/supabaseClient';
import { getSession } from '../features/auth/session';
import { getDashboardSnapshot } from '../api/tauriClient';
import type { EquityRow } from '../types';

// ---------------------------------------------------------------------------
// usePortfolio — Supabase-backed portfolio hook with realtime sync
//
// • Session varsa: Supabase `user_portfolio_items` tablosundan okur/yazar
// • Session yoksa: localStorage fallback (mevcut davranış korunur)
// • İlk oturumda: localStorage watchlist'i otomatik migrate eder
// • Canlı fiyat: getDashboardSnapshot() ile zenginleştirir
// ---------------------------------------------------------------------------

export interface PortfolioItem {
  id: string;
  ticker: string;
  shares: number;
  costBasis: number;
  createdAt: string;
  updatedAt: string;
  // Client-side enrichment (canlı fiyattan):
  name?: string;
  currentPrice?: number;
  prevClose?: number;
  marketValue?: number;
  costValue?: number;
  profitLoss?: number;
  profitLossPct?: number;
  dailyChange?: number;
  dailyChangePct?: number;
  weight?: number;
  sector?: string;
}

export interface PortfolioTotals {
  totalCost: number;
  totalValue: number;
  totalPL: number;
  totalPLPct: number;
  dailyPL: number;
  dailyPLPct: number;
  positionCount: number;
}

const LOCAL_KEY = 'fraude-watchlist';
const MIGRATE_FLAG = 'fraude-portfolio-migrated';

interface LocalWatchlistItem {
  ticker: string;
  addedAt: string;
  addedPrice: number;
  quantity?: number;
  note?: string;
  thesis?: string;
}

function readLocalWatchlist(): LocalWatchlistItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Handle legacy string[] format
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((ticker: string) => ({ ticker, addedAt: new Date().toISOString(), addedPrice: 0 }));
    }
    return parsed;
  } catch {
    return [];
  }
}

function enrichItems(
  items: PortfolioItem[],
  equities: EquityRow[],
): PortfolioItem[] {
  const eqMap = new Map(equities.map(e => [e.ticker, e]));
  let totalValue = 0;

  const enriched = items.map(item => {
    const eq = eqMap.get(item.ticker) || eqMap.get(`${item.ticker}.IS`);
    const currentPrice = eq?.price ?? 0;
    const prevClose = currentPrice > 0 && eq?.change_pct != null
      ? currentPrice / (1 + eq.change_pct / 100)
      : currentPrice;
    const marketValue = item.shares * currentPrice;
    const costValue = item.shares * item.costBasis;
    const profitLoss = marketValue - costValue;
    const profitLossPct = costValue > 0 ? (profitLoss / costValue) * 100 : 0;
    const dailyPriceChange = currentPrice - prevClose;
    const dailyChange = item.shares * dailyPriceChange;
    const dailyChangePct = eq?.change_pct ?? 0;

    totalValue += marketValue;

    return {
      ...item,
      name: eq?.name || item.ticker,
      currentPrice,
      prevClose,
      marketValue,
      costValue,
      profitLoss,
      profitLossPct,
      dailyChange,
      dailyChangePct,
      sector: eq?.index_memberships?.[0] || undefined,
    };
  });

  // Calculate weights
  if (totalValue > 0) {
    for (const item of enriched) {
      item.weight = ((item.marketValue ?? 0) / totalValue) * 100;
    }
  }

  return enriched;
}

function computeTotals(items: PortfolioItem[]): PortfolioTotals {
  let totalCost = 0;
  let totalValue = 0;
  let dailyPL = 0;

  for (const item of items) {
    totalCost += item.costValue ?? 0;
    totalValue += item.marketValue ?? 0;
    dailyPL += item.dailyChange ?? 0;
  }

  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const prevTotalValue = totalValue - dailyPL;
  const dailyPLPct = prevTotalValue > 0 ? (dailyPL / prevTotalValue) * 100 : 0;

  return {
    totalCost,
    totalValue,
    totalPL,
    totalPLPct,
    dailyPL,
    dailyPLPct,
    positionCount: items.length,
  };
}

export function usePortfolio() {
  const [rawItems, setRawItems] = useState<PortfolioItem[]>([]);
  const [equities, setEquities] = useState<EquityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrated, setMigrated] = useState(false);
  const loadedRef = useRef(false);

  const session = getSession();
  const userId = session?.id;

  // ── Load equities for price enrichment ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getDashboardSnapshot()
      .then(snap => {
        if (!cancelled && snap?.equities) {
          setEquities(snap.equities);
        }
      })
      .catch(() => {});

    // Re-fetch every 60s for live prices
    const interval = setInterval(() => {
      getDashboardSnapshot()
        .then(snap => {
          if (!cancelled && snap?.equities) {
            setEquities(snap.equities);
          }
        })
        .catch(() => {});
    }, 60_000);

    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Load portfolio data ────────────────────────────────────────────────
  const loadFromSupabase = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('user_portfolio_items')
      .select('id, ticker, shares, cost_basis, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (data) {
      setRawItems(data.map(row => ({
        id: row.id,
        ticker: row.ticker,
        shares: Number(row.shares),
        costBasis: Number(row.cost_basis),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })));
    }
    setLoading(false);
  }, [userId]);

  const loadFromLocalStorage = useCallback(() => {
    const local = readLocalWatchlist();
    setRawItems(local
      .filter(item => (item.quantity ?? 0) > 0 && item.addedPrice > 0)
      .map((item, i) => ({
        id: `local-${i}`,
        ticker: item.ticker,
        shares: item.quantity ?? 0,
        costBasis: item.addedPrice,
        createdAt: item.addedAt,
        updatedAt: item.addedAt,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    if (userId) {
      void loadFromSupabase();
    } else {
      loadFromLocalStorage();
    }
  }, [userId, loadFromSupabase, loadFromLocalStorage]);

  // ── Migrate localStorage → Supabase (tek seferlik) ─────────────────────
  useEffect(() => {
    if (!userId || migrated) return;
    if (localStorage.getItem(MIGRATE_FLAG)) return;

    const local = readLocalWatchlist();
    const withPositions = local.filter(item => (item.quantity ?? 0) > 0 && item.addedPrice > 0);
    if (withPositions.length === 0) {
      localStorage.setItem(MIGRATE_FLAG, '1');
      return;
    }

    // Only migrate if Supabase is empty
    void (async () => {
      const { count } = await supabase
        .from('user_portfolio_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if ((count ?? 0) > 0) {
        localStorage.setItem(MIGRATE_FLAG, '1');
        return;
      }

      const rows = withPositions.map(item => ({
        user_id: userId,
        ticker: item.ticker,
        shares: item.quantity!,
        cost_basis: item.addedPrice,
      }));

      const { error } = await supabase.from('user_portfolio_items').insert(rows);
      if (!error) {
        localStorage.setItem(MIGRATE_FLAG, '1');
        setMigrated(true);
        void loadFromSupabase();
      }
    })();
  }, [userId, migrated, loadFromSupabase]);

  // ── Realtime subscription ──────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`portfolio:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_portfolio_items',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void loadFromSupabase();
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId, loadFromSupabase]);

  // ── CRUD operations ────────────────────────────────────────────────────
  const addPosition = useCallback(async (ticker: string, shares: number, costBasis: number) => {
    if (!userId) return;
    await supabase.from('user_portfolio_items').upsert({
      user_id: userId,
      ticker: ticker.toUpperCase(),
      shares,
      cost_basis: costBasis,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,ticker' });
    // Realtime will trigger reload
  }, [userId]);

  const updatePosition = useCallback(async (ticker: string, shares: number, costBasis: number) => {
    if (!userId) return;
    await supabase
      .from('user_portfolio_items')
      .update({ shares, cost_basis: costBasis, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('ticker', ticker.toUpperCase());
  }, [userId]);

  const removePosition = useCallback(async (ticker: string) => {
    if (!userId) return;
    await supabase
      .from('user_portfolio_items')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', ticker.toUpperCase());
  }, [userId]);

  // ── Enriched output ────────────────────────────────────────────────────
  const items = enrichItems(rawItems, equities);
  const totals = computeTotals(items);

  return {
    items,
    totals,
    loading,
    migrated,
    hasSession: Boolean(userId),
    addPosition,
    updatePosition,
    removePosition,
    refresh: userId ? loadFromSupabase : loadFromLocalStorage,
  };
}
