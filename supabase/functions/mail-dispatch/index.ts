// FRAUDE — bildirim kuyruğunu boşaltan gönderici.
// ─────────────────────────────────────────────────────────────────────────────
// market-watch artık mail göndermez, yalnız notify_outbox'a yazar. Bu fonksiyon
// kuyruğu dakikada bir boşaltır. Ayrım şu yüzden var: tek bir yavaş alıcı
// sunucusu tespit turunu (KAP/SPK imleçleri) bloklamamalı.
//
// Akış:
//   1) Takılı kalmış 'sending' satırları kurtarılır (reap_stuck_outbox).
//   2) claim_outbox_batch ile parti atomik olarak kilitlenir — üst üste binen
//      cron turları aynı maili iki kez göndermez.
//   3) Kullanıcı kanalları toplu okunur, gönderim sınırlı eşzamanlılıkla yapılır.
//   4) Geçici hata üstel geri çekilmeyle yeniden kuyruğa; kalıcı hata doğrudan
//      'failed'. Kullanıcının kanalı üst üste 5 kez hata verirse devre dışı
//      bırakılır ve durum kendisine platform kanalından bildirilir.
//
// Kurulum:
//   supabase functions deploy mail-dispatch --no-verify-jwt --use-api
//   Secrets: BREVO_API_KEY, MAIL_FROM, MAIL_CRED_KEY, CRON_SECRET
//   Cron (SQL Editor):
//     select cron.schedule('mail-dispatch', '* * * * *', $$
//       select net.http_post(
//         url := 'https://<proje>.supabase.co/functions/v1/mail-dispatch',
//         headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
//       );
//     $$);

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  decryptSecret,
  scrubError,
  sendViaPlatform,
  sendWithTransport,
  type StoredSecret,
  type TransportRow,
} from '../_shared/mailer.ts';

/** Bir mail kaç kez denenir. Sonrasında 'failed' olarak bırakılır. */
const MAX_ATTEMPTS = 5;

/** Kaç ardışık hatadan sonra kullanıcının kanalı devre dışı bırakılır. */
const FAILURES_BEFORE_DISABLE = 5;

/** Aynı anda kaç gönderim uçuşta olsun. */
const CONCURRENCY = 5;

/** Tek turda kaç mail alınsın. Wall-clock sınırına göre muhafazakâr tutuldu. */
const DEFAULT_BATCH = 25;

/** attempts=1 → 1dk, 2 → 5dk, 3 → 15dk, 4 → 60dk. */
const BACKOFF_MINUTES = [1, 5, 15, 60];

interface OutboxRow {
  id: string;
  user_id: string;
  to_email: string;
  subject: string;
  html: string;
  payload: Record<string, unknown> | null;
  attempts: number;
}

function backoffFor(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 60;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Kanalı devre dışı bırakırken kullanıcıya giden bilgilendirme. */
function renderTransportDisabledHtml(reason: string): string {
  const safe = reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12"><tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;font-family:'SF Mono',Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:5px;color:#e8f0f7;"><span style="color:#00e896;">F</span>RAUDE</td></tr>
      <tr><td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:32px 30px;">
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:18px;font-weight:700;color:#e8f0f7;margin-bottom:12px;">Kendi gönderim kanalınız devre dışı bırakıldı</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#b7c2cc;line-height:1.7;">
          Bildirimleriniz için tanımladığınız kanal üst üste ${FAILURES_BEFORE_DISABLE} kez hata verdi, bu yüzden geçici olarak kapatıldı.
          Bildirimleriniz kesilmedi — FRAUDE kendi sunucusundan göndermeye devam ediyor.
          <br><br>
          <span style="color:#8b949e;">Son hata:</span><br>
          <code style="display:block;margin-top:6px;padding:12px;background:#0d1117;border:1px solid #21262d;border-radius:8px;font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#ff8f85;word-break:break-all;">${safe}</code>
          <br>
          Ayarlarınızı gözden geçirip <b>Hesap → Gönderim kanalı</b> bölümünden yeniden doğrulayabilirsiniz.
        </div>
      </td></tr>
      <tr><td align="center" style="padding-top:22px;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;color:#8b949e;">FRAUDE Terminal — finansal dostunuz</td></tr>
    </table></td></tr></table></body></html>`;
}

/** Sabit havuzlu eşzamanlılık: N iş paralel, sıradaki iş boşalan yuvaya girer. */
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const batchSize = Math.min(
    100,
    Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? DEFAULT_BATCH)),
  );

  // 1) Önceki turdan asılı kalanları geri al.
  const { data: reaped } = await supabase.rpc('reap_stuck_outbox');

  // 2) Partiyi kilitle.
  const { data: claimed, error: claimError } = await supabase.rpc('claim_outbox_batch', {
    p_limit: batchSize,
  });
  if (claimError) {
    console.error('claim-failed', claimError.message);
    return new Response(JSON.stringify({ ok: false, error: claimError.message }), { status: 500 });
  }

  const rows = (claimed ?? []) as OutboxRow[];
  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, claimed: 0, sent: 0, retried: 0, failed: 0, reaped: reaped ?? 0 }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 3) Bu partideki kullanıcıların kanallarını ve sırlarını tek seferde oku.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

  const [{ data: transportRows }, { data: secretRows }] = await Promise.all([
    supabase
      .from('notify_transports')
      .select('user_id, kind, webhook_url, api_provider, from_email, from_name, verified_at, failure_count, disabled_at')
      .in('user_id', userIds),
    supabase
      .from('notify_transport_secrets')
      .select('user_id, ciphertext, iv, key_version')
      .in('user_id', userIds),
  ]);

  const transports = new Map<string, TransportRow>();
  for (const t of (transportRows ?? []) as TransportRow[]) transports.set(t.user_id, t);

  // Sırlar tembel çözülür: platform kanalı kullanan kullanıcı için gereksiz
  // kripto işi yapılmaz, ayrıca çözme hatası tüm turu düşürmez.
  const rawSecrets = new Map<string, StoredSecret>();
  for (const s of (secretRows ?? []) as Array<StoredSecret & { user_id: string }>) {
    rawSecrets.set(s.user_id, { ciphertext: s.ciphertext, iv: s.iv, key_version: s.key_version });
  }
  const secretCache = new Map<string, string | null>();
  async function secretFor(userId: string): Promise<string | null> {
    if (secretCache.has(userId)) return secretCache.get(userId)!;
    const stored = rawSecrets.get(userId);
    let value: string | null = null;
    if (stored) {
      try {
        value = await decryptSecret(stored);
      } catch (e) {
        console.error('secret-decrypt-failed', userId, scrubError(e));
      }
    }
    secretCache.set(userId, value);
    return value;
  }

  // Tur içinde devre dışı bıraktığımız kullanıcılar: aynı partideki sonraki
  // mailleri doğrudan platform'dan gitsin, bir daha aynı hataya çarpmasın.
  const disabledThisRun = new Set<string>();

  let sent = 0;
  let retried = 0;
  let failed = 0;

  await pooled(rows, CONCURRENCY, async (row) => {
    const transport = disabledThisRun.has(row.user_id)
      ? null
      : transports.get(row.user_id) ?? null;

    const needsSecret = transport && transport.kind !== 'platform' && !disabledThisRun.has(row.user_id);
    const secret = needsSecret ? await secretFor(row.user_id) : null;

    const result = await sendWithTransport(transport, secret, {
      to: row.to_email,
      subject: row.subject,
      html: row.html,
      payload: row.payload ?? undefined,
    });

    if (result.ok) {
      sent++;
      await supabase
        .from('notify_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id);

      // Kullanıcının kendi kanalı çalıştı: hata sayacını sıfırla.
      if (result.usedKind !== 'platform' && transport && transport.failure_count > 0) {
        await supabase
          .from('notify_transports')
          .update({ failure_count: 0, last_error: null, updated_at: new Date().toISOString() })
          .eq('user_id', row.user_id);
      }
      return;
    }

    const error = result.error ?? 'unknown-error';
    const canRetry = result.retryable && row.attempts < MAX_ATTEMPTS;

    await supabase
      .from('notify_outbox')
      .update(
        canRetry
          ? { status: 'pending', next_attempt_at: backoffFor(row.attempts), last_error: error }
          : { status: 'failed', last_error: error },
      )
      .eq('id', row.id);

    if (canRetry) retried++;
    else failed++;

    // Hata kullanıcının kendi kanalından geldiyse sağlık sayacını işlet.
    // Platform kanalının hatası kullanıcının konfigürasyonuyla ilgili değildir.
    if (result.usedKind === 'platform' || !transport) return;

    const nextCount = transport.failure_count + 1;
    const shouldDisable = nextCount >= FAILURES_BEFORE_DISABLE;

    await supabase
      .from('notify_transports')
      .update({
        failure_count: nextCount,
        last_error: error,
        disabled_at: shouldDisable ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', row.user_id);

    if (!shouldDisable) return;

    disabledThisRun.add(row.user_id);
    // Bilgilendirme kuyruğa değil doğrudan platform'a verilir: kullanıcının
    // kanalı bozukken "kanalın bozuk" mesajını o kanaldan göndermek anlamsız.
    const notice = await sendViaPlatform({
      to: row.to_email,
      subject: 'FRAUDE — kendi gönderim kanalınız devre dışı bırakıldı',
      html: renderTransportDisabledHtml(error),
    });
    if (!notice.ok) console.error('disable-notice-failed', scrubError(notice.error));
  });

  return new Response(
    JSON.stringify({
      ok: true,
      claimed: rows.length,
      sent,
      retried,
      failed,
      reaped: reaped ?? 0,
      disabled: disabledThisRun.size,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
