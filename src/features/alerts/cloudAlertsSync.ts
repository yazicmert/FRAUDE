import { supabase } from '../auth/supabaseClient';
import { getSession } from '../auth/session';
import type { AlertRule } from './alertTypes';

export interface CloudAlertRow {
  id: string;
  user_id: string;
  ticker: string;
  metric: string;
  op: string;
  threshold: number | null;
  keywords: string[] | null;
  note: string | null;
  enabled: boolean;
  repeat: boolean;
  email_notify: boolean;
  is_triggered: boolean;
  created_at: string;
  triggered_at: string | null;
}

/**
 * Bir alarm kuralını Supabase bulut tablosuna eşitler.
 */
export async function syncRuleToCloud(rule: AlertRule): Promise<boolean> {
  const session = getSession();
  if (!session) return false;

  try {
    const payload = {
      id: rule.id,
      user_id: session.id,
      ticker: rule.ticker.toUpperCase().replace('.IS', ''),
      metric: rule.metric,
      op: rule.op,
      threshold: Number.isFinite(rule.threshold) ? rule.threshold : null,
      keywords: rule.keywords || [],
      note: rule.note || null,
      enabled: rule.enabled,
      repeat: rule.repeat,
      email_notify: rule.emailNotify !== false,
      created_at: rule.createdAt || new Date().toISOString(),
      triggered_at: rule.lastTriggeredAt || null,
    };

    const { error } = await supabase.from('user_alerts').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('syncRuleToCloud error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('syncRuleToCloud exception:', err);
    return false;
  }
}

/**
 * Bir alarm kuralını buluttan siler.
 */
export async function deleteRuleFromCloud(ruleId: string): Promise<boolean> {
  const session = getSession();
  if (!session) return false;

  try {
    const { error } = await supabase.from('user_alerts').delete().eq('id', ruleId).eq('user_id', session.id);
    if (error) {
      console.warn('deleteRuleFromCloud error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('deleteRuleFromCloud exception:', err);
    return false;
  }
}

/**
 * Kullanıcının buluttaki tüm alarmlarını çeker.
 */
export async function fetchCloudRules(): Promise<AlertRule[] | null> {
  const session = getSession();
  if (!session) return null;

  try {
    const { data, error } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', session.id)
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.warn('fetchCloudRules error:', error?.message);
      return null;
    }

    return (data as CloudAlertRow[]).map((row) => ({
      id: row.id,
      ticker: row.ticker,
      metric: row.metric as any,
      op: row.op as any,
      threshold: row.threshold ?? 0,
      keywords: row.keywords || [],
      note: row.note || undefined,
      enabled: row.enabled,
      repeat: row.repeat,
      emailNotify: row.email_notify,
      createdAt: row.created_at,
      lastTriggeredAt: row.triggered_at,
      lastMet: null,
    }));
  } catch (err) {
    console.warn('fetchCloudRules exception:', err);
    return null;
  }
}
