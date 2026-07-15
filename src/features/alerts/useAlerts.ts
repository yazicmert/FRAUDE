import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardSnapshot, getTickerSnapshot } from '../../api/tauriClient';
import type { EquityRow } from '../../types';
import { notify } from '../../lib/notify';
import {
  type AlertRule,
  type TriggeredAlert,
  describeRule,
  evaluateRule,
} from './alertTypes';

const RULES_KEY = 'fraude-alerts';
const LOG_KEY = 'fraude-alert-log';
const RULES_EVENT = 'fraude-alerts-updated';
const LOG_EVENT = 'fraude-alert-log-updated';
const MAX_LOG = 100;

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadLog(): TriggeredAlert[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRules(rules: AlertRule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  window.dispatchEvent(new CustomEvent(RULES_EVENT, { detail: rules }));
}

function saveLog(log: TriggeredAlert[]) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
  window.dispatchEvent(new CustomEvent(LOG_EVENT, { detail: log }));
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fiyat/teknik alarm kurallarını yönetir ve `engine: true` ile çağrıldığında
 * her veri senkronunda kuralları değerlendirip bildirim üretir. Motor yalnızca
 * bir kez (App) monte edilmeli; yönetim panelleri motorsuz çağırıp aynı
 * localStorage + olay üzerinden senkron kalır.
 */
export function useAlerts(options: { engine?: boolean } = {}) {
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules());
  const [log, setLog] = useState<TriggeredAlert[]>(() => loadLog());
  const evaluatingRef = useRef(false);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // Diğer bileşenlerin yaptığı değişiklikleri dinle.
  useEffect(() => {
    const onRules = (e: Event) => setRules((e as CustomEvent<AlertRule[]>).detail);
    const onLog = (e: Event) => setLog((e as CustomEvent<TriggeredAlert[]>).detail);
    window.addEventListener(RULES_EVENT, onRules);
    window.addEventListener(LOG_EVENT, onLog);
    return () => {
      window.removeEventListener(RULES_EVENT, onRules);
      window.removeEventListener(LOG_EVENT, onLog);
    };
  }, []);

  const addRule = useCallback((rule: Omit<AlertRule, 'id' | 'createdAt' | 'lastTriggeredAt' | 'lastMet'>) => {
    const next: AlertRule = {
      ...rule,
      id: uid(),
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
      lastMet: null,
    };
    const merged = [next, ...rulesRef.current];
    setRules(merged);
    saveRules(merged);
    return next;
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<AlertRule>) => {
    const merged = rulesRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setRules(merged);
    saveRules(merged);
  }, []);

  const removeRule = useCallback((id: string) => {
    const merged = rulesRef.current.filter((r) => r.id !== id);
    setRules(merged);
    saveRules(merged);
  }, []);

  const markLogRead = useCallback(() => {
    const merged = loadLog().map((t) => ({ ...t, read: true }));
    setLog(merged);
    saveLog(merged);
  }, []);

  const clearLog = useCallback(() => {
    setLog([]);
    saveLog([]);
  }, []);

  // ── Değerlendirme motoru ──────────────────────────────────────────────
  const evaluate = useCallback(async () => {
    if (evaluatingRef.current) return;
    const active = loadRules().filter((r) => r.enabled);
    if (active.length === 0) return;
    evaluatingRef.current = true;
    try {
      // Anlık verileri topla: önce dashboard evreninden, eksikleri tek tek.
      const byTicker = new Map<string, EquityRow>();
      try {
        const snap = await getDashboardSnapshot();
        for (const row of [...snap.equities, ...snap.top_gainers, ...snap.risk_watch]) {
          if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, row);
        }
      } catch {
        // dashboard alınamazsa yalnızca tek-tek fetch'e düşülür
      }
      const needed = Array.from(new Set(active.map((r) => r.ticker))).filter((tk) => !byTicker.has(tk));
      await Promise.all(
        needed.map(async (tk) => {
          try {
            const snap = await getTickerSnapshot(tk);
            byTicker.set(tk, snap.equity);
          } catch {
            /* atla */
          }
        }),
      );

      const now = new Date().toISOString();
      const triggered: TriggeredAlert[] = [];
      const currentRules = loadRules();
      const nextRules = currentRules.map((rule) => {
        if (!rule.enabled) return rule;
        const eq = byTicker.get(rule.ticker);
        if (!eq) return rule;
        const res = evaluateRule(rule, eq);
        if (!res) return rule;

        // İlk değerlendirme: mevcut durumu baz al, tetikleme yapma.
        if (rule.lastMet === null) {
          return { ...rule, lastMet: res.met };
        }
        // Kenar tetikleme: yanlıştan doğruya geçiş.
        if (res.met && !rule.lastMet) {
          triggered.push({
            id: uid(),
            ruleId: rule.id,
            ticker: rule.ticker,
            message: describeRule(rule),
            value: res.value,
            at: now,
            read: false,
          });
          return {
            ...rule,
            lastMet: true,
            lastTriggeredAt: now,
            enabled: rule.repeat ? true : false,
          };
        }
        return { ...rule, lastMet: res.met };
      });

      if (triggered.length > 0) {
        const mergedLog = [...triggered, ...loadLog()].slice(0, MAX_LOG);
        setLog(mergedLog);
        saveLog(mergedLog);
        for (const t of triggered) {
          void notify({
            title: `🔔 Alarm · ${t.ticker}`,
            body: `${t.message} — güncel: ${t.value.toFixed(2)}`,
            kind: 'warning',
            tag: `alert-${t.ruleId}`,
          });
        }
      }
      // Kural durumları (lastMet / enabled) her zaman güncellenip saklanır.
      setRules(nextRules);
      saveRules(nextRules);
    } finally {
      evaluatingRef.current = false;
    }
  }, []);

  // Motor modu: her senkron tamamlandığında değerlendir.
  useEffect(() => {
    if (!options.engine) return;
    const onSync = () => void evaluate();
    window.addEventListener('fraude-sync-completed', onSync);
    // İlk açılışta bir kez baz durumu kur.
    void evaluate();
    return () => window.removeEventListener('fraude-sync-completed', onSync);
  }, [options.engine, evaluate]);

  const unread = log.filter((t) => !t.read).length;

  return { rules, log, unread, addRule, updateRule, removeRule, markLogRead, clearLog };
}
