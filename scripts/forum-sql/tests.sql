-- docs/supabase-forum.sql davranış testleri.
--
-- Çalıştırmak için: scripts/test-forum-sql.sh (geçici bir Postgres kümesi kurar,
-- stub'ı ve gerçek şemayı yükler, sonra bu dosyayı çalıştırır).
--
-- İddiaların hepsi forumun "güven sunucudadır" sözünü sınar: istemci ne
-- gönderirse göndersin kimlik, sayaç, etiket, görünürlük ve hız sınırlarına
-- veritabanı karar verir.

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

\set ADA    '''11111111-1111-1111-1111-111111111111'''
\set BORAN  '''22222222-2222-2222-2222-222222222222'''
\set CEYDA  '''33333333-3333-3333-3333-333333333333'''
\set MOD    '''44444444-4444-4444-4444-444444444444'''
\set ELIF   '''55555555-5555-5555-5555-555555555555'''
\set FERIT  '''66666666-6666-6666-6666-666666666666'''

-- Moderatör listesi: gerçekte SQL editöründen doldurulur.
insert into forum_moderators (user_id) values (:MOD) on conflict do nothing;

-- Testler arası gönderi kimliklerini taşıyan geçici tablo.
create table if not exists tst_state (key text primary key, id uuid);
grant select, insert, update, delete on tst_state to authenticated;

\echo ''
\echo '── 1. Kimlik ve normalleştirme ─────────────────────────────────────────'
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare
  v_id uuid;
  r    forum_posts%rowtype;
begin
  -- İstemci elinden geleni yapar: başkasının kimliği, uydurma ad, şişirilmiş
  -- sayaç, çöp etiketler, geçmiş tarih.
  insert into forum_posts (user_id, author_name, body, tickers, like_count, reply_count, created_at)
  values (
    '22222222-2222-2222-2222-222222222222',
    'Elon Musk',
    '  $thyao ve $GARAN güçlü duruyor  ',
    array['$100', '  thyao ', 'GARAN', 'xyz!', 'THYAO'],
    9999, 42, now() - interval '10 years'
  )
  returning id into v_id;
  insert into tst_state values ('ada-root', v_id);

  select * into r from forum_posts where id = v_id;
  perform tst_assert(r.user_id = '11111111-1111-1111-1111-111111111111', 'user_id oturumdan yazılıyor');
  perform tst_assert(r.author_name = 'Ada Test', 'author_name JWT metadata.name''den geliyor');
  perform tst_assert(r.like_count = 0 and r.reply_count = 0, 'sayaçlar istemciden alınmıyor');
  perform tst_assert(r.tickers = array['GARAN', 'THYAO'], 'etiketler normalleşip tekilleşiyor: ' || r.tickers::text);
  perform tst_assert(r.body = '$thyao ve $GARAN güçlü duruyor', 'gövde kırpılıyor');
  perform tst_assert(r.created_at > now() - interval '1 minute', 'created_at sunucu saatinden');
  perform tst_assert(r.report_count = 0 and r.hidden_at is null, 'yeni gönderi görünür ve bildirimsiz');
end
$$;

-- Ad sırası session.ts:toUser ile aynı olmalı: name → full_name → user_name →
-- e-posta yerel parçası.
reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
do $$
declare v_id uuid;
begin
  insert into forum_posts (body) values ('full_name kullanılmalı') returning id into v_id;
  perform tst_assert(
    (select author_name from forum_posts where id = v_id) = 'Boran Test',
    'metadata.full_name ikinci sırada');
end
$$;

reset role;
select tst_login(:CEYDA) \g /dev/null
set role authenticated;
do $$
declare v_id uuid;
begin
  insert into forum_posts (body) values ('metadata yok, e-postadan türetilmeli') returning id into v_id;
  perform tst_assert(
    (select author_name from forum_posts where id = v_id) = 'ceyda',
    'metadata boşsa e-posta yerel parçası');
end
$$;

\echo ''
\echo '── 2. Türkçe metin bozulmuyor ──────────────────────────────────────────'
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare
  v_id   uuid;
  v_text text := 'İŞ BANKASI $ISCTR hakkında İSTİKRARLI görüş — ıIiİ şŞ ğĞ';
  v_back text;
begin
  insert into forum_posts (body, tickers) values (v_text, array['ISCTR']) returning id into v_id;
  select body into v_back from forum_posts where id = v_id;
  -- Gövde hiçbir yerde büyük/küçük harfe çevrilmez; 'İ' bayt uzunluğunu
  -- değiştirdiği için tek bir upper() çağrısı metni kaydırmaya yeter.
  perform tst_assert(v_back = v_text, 'gövde birebir korunuyor');
  perform tst_assert(octet_length(v_back) = octet_length(v_text), 'bayt uzunluğu değişmiyor');
end
$$;

\echo ''
\echo '── 3. Beğeni ve yanıt sayaçları ────────────────────────────────────────'
reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
do $$
declare v_root uuid := (select id from tst_state where key = 'ada-root');
begin
  insert into forum_likes (post_id) values (v_root);
  perform tst_assert((select like_count from forum_posts where id = v_root) = 1, 'beğeni sayacı artıyor');
  delete from forum_likes where post_id = v_root;
  perform tst_assert((select like_count from forum_posts where id = v_root) = 0, 'beğeni geri alınınca düşüyor');
  insert into forum_likes (post_id) values (v_root);
end
$$;

do $$
declare
  v_root  uuid := (select id from tst_state where key = 'ada-root');
  v_reply uuid;
  v_deep  uuid;
begin
  insert into forum_posts (body, parent_id) values ('birinci yanıt', v_root) returning id into v_reply;
  insert into tst_state values ('boran-reply', v_reply);
  perform tst_assert((select reply_count from forum_posts where id = v_root) = 1, 'yanıt sayacı artıyor');

  -- Yanıta yanıt kök konuya düşer: iş parçacığı tek seviye kalır.
  insert into forum_posts (body, parent_id) values ('yanıta yanıt', v_reply) returning id into v_deep;
  perform tst_assert((select parent_id from forum_posts where id = v_deep) = v_root, 'yanıta yanıt köke düşüyor');
  perform tst_assert((select reply_count from forum_posts where id = v_root) = 2, 'kök sayacı iki yanıt sayıyor');

  update forum_posts set deleted_at = now() where id = v_deep;
  perform tst_assert((select reply_count from forum_posts where id = v_root) = 1, 'yanıt silinince sayaç düşüyor');
end
$$;

\echo ''
\echo '── 4. Düzenleme ve silme ───────────────────────────────────────────────'
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare
  v_root uuid := (select id from tst_state where key = 'ada-root');
  r      forum_posts%rowtype;
begin
  -- Sahiplik ve sayaç alanları UPDATE ile oynanamaz.
  update forum_posts
     set user_id = '22222222-2222-2222-2222-222222222222',
         author_name = 'Elon Musk',
         like_count = 9999,
         reply_count = 9999,
         report_count = 9999,
         created_at = now() - interval '10 years',
         body = '$thyao düzenlendi',
         tickers = array['thyao']
   where id = v_root;

  select * into r from forum_posts where id = v_root;
  perform tst_assert(r.user_id = '11111111-1111-1111-1111-111111111111', 'user_id sabitleniyor');
  perform tst_assert(r.author_name = 'Ada Test', 'author_name sabitleniyor');
  perform tst_assert(r.like_count = 1 and r.reply_count = 1, 'sayaçlar sabitleniyor');
  perform tst_assert(r.report_count = 0, 'report_count sabitleniyor');
  perform tst_assert(r.body = '$thyao düzenlendi', 'gövde düzenlenebiliyor');
  perform tst_assert(r.tickers = array['THYAO'], 'düzenlemede de etiket normalleşiyor');
  perform tst_assert(r.edited_at is not null, 'edited_at damgalanıyor');
end
$$;

-- Başkasının gönderisi düzenlenemez / silinemez (RLS).
reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
do $$
declare
  v_root uuid := (select id from tst_state where key = 'ada-root');
  v_body text;
begin
  update forum_posts set body = 'ele geçirildi' where id = v_root;
  select body into v_body from forum_posts where id = v_root;
  perform tst_assert(v_body = '$thyao düzenlendi', 'başkasının gönderisi RLS ile korunuyor');
end
$$;

\echo ''
\echo '── 5. Kök silme yanıtları da düşürüyor ─────────────────────────────────'
reset role;
select tst_login(:ELIF) \g /dev/null
set role authenticated;
do $$
declare
  v_root  uuid;
  v_reply uuid;
begin
  insert into forum_posts (body, tickers) values ('silinecek kök konu', array['ASELS']) returning id into v_root;
  insert into forum_posts (body, parent_id) values ('bu yanıt da düşmeli', v_root) returning id into v_reply;

  update forum_posts set deleted_at = now() where id = v_root;

  perform tst_assert((select body from forum_posts where id = v_root) = '', 'silinen gövde gerçekten boşalıyor');
  perform tst_assert((select tickers from forum_posts where id = v_root) = '{}', 'silinen gönderi etiketlerini bırakıyor');
  perform tst_assert((select deleted_at from forum_posts where id = v_reply) is not null, 'kök silinince yanıt da siliniyor');
  perform tst_assert((select body from forum_posts where id = v_reply) = '', 'yanıtın gövdesi de boşalıyor');
end
$$;

do $$
declare
  v_root uuid := (select id from forum_posts where body = '' and deleted_at is not null
                   and user_id = '55555555-5555-5555-5555-555555555555' and parent_id is null limit 1);
begin
  -- Silinen gönderi geri getirilemez.
  update forum_posts set deleted_at = null, body = 'geri geldim' where id = v_root;
  perform tst_assert((select deleted_at from forum_posts where id = v_root) is not null, 'silme geri alınamıyor');
  perform tst_assert((select body from forum_posts where id = v_root) = '', 'silinen gövde geri yazılamıyor');
end
$$;

\echo ''
\echo '── 6. Bildirim ve otomatik gizleme ─────────────────────────────────────'
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare v_id uuid;
begin
  insert into forum_posts (body, tickers) values ('bildirilecek gönderi $KCHOL', array['KCHOL'])
    returning id into v_id;
  insert into tst_state values ('reported', v_id);
end
$$;

reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
insert into forum_reports (post_id, reason) select id, 'spam' from tst_state where key = 'reported';
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert((select report_count from forum_posts where id = v_id) = 1, 'bildirim sayacı işliyor');
  perform tst_assert((select hidden_at from forum_posts where id = v_id) is null, 'tek bildirim gizlemiyor');
end
$$;

-- Aynı kişi ikinci kez bildiremez: sayaç kişi sayar, tık değil.
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  begin
    insert into forum_reports (post_id, reason) values (v_id, 'abuse');
    perform tst_assert(false, 'aynı kişinin ikinci bildirimi reddedilmeli');
  exception when unique_violation then
    perform tst_assert(true, 'aynı kişi aynı gönderiyi bir kez bildiriyor');
  end;
end
$$;

reset role;
select tst_login(:CEYDA) \g /dev/null
set role authenticated;
insert into forum_reports (post_id, reason) select id, 'abuse' from tst_state where key = 'reported';

reset role;
select tst_login(:ELIF) \g /dev/null
set role authenticated;
insert into forum_reports (post_id, reason) select id, 'misinfo' from tst_state where key = 'reported';

-- Sonucu YAZARIN gözünden okuyoruz: eşik aşılınca gönderi gizlenir ve
-- bildiren kişi onu artık göremez (RLS'in kendisi de böyle sınanmış olur).
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
  r forum_posts%rowtype;
begin
  select * into r from forum_posts where id = v_id;
  perform tst_assert(r.report_count = 3, 'üçüncü bildirim sayaca yansıyor');
  perform tst_assert(r.hidden_at is not null, 'eşiği aşan gönderi kendiliğinden gizleniyor');
  perform tst_assert(r.hidden_reason = 'auto', 'otomatik gizleme sebebi işaretleniyor');
  perform tst_assert(r.body <> '', 'gizleme gövdeyi silmiyor (karar geri alınabilir)');
end
$$;

\echo ''
\echo '── 7. Gizli gönderinin görünürlüğü ─────────────────────────────────────'
-- Üçüncü kullanıcı ve bildirenler göremez: süzme istemcide değil, RLS'te.
reset role;
select tst_login(:FERIT) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert((select count(*) from forum_posts where id = v_id) = 0, 'gizli gönderi üçüncü kişiye görünmüyor');
end
$$;

reset role;
select tst_login(:ELIF) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert((select count(*) from forum_posts where id = v_id) = 0, 'gizli gönderi bildirene de görünmüyor');
end
$$;

-- Yazarı görür ama düzenleyemez; silebilir.
reset role;
select tst_login(:ADA) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert((select count(*) from forum_posts where id = v_id) = 1, 'yazar kendi gizli gönderisini görüyor');

  update forum_posts set body = 'gizliyken düzenledim' where id = v_id;
  perform tst_assert((select body from forum_posts where id = v_id) = 'bildirilecek gönderi $KCHOL',
    'gizli gönderi düzenlenemiyor');

  -- Yazar gizlemeyi kendi kaldıramaz.
  update forum_posts set hidden_at = null, hidden_reason = null where id = v_id;
  perform tst_assert((select hidden_at from forum_posts where id = v_id) is not null,
    'yazar gizlemeyi kaldıramıyor');
end
$$;

-- Moderatör görür.
reset role;
select tst_login(:MOD) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert(forum_is_moderator(), 'moderatör kendini tanıyor');
  perform tst_assert((select count(*) from forum_posts where id = v_id) = 1, 'moderatör gizli gönderiyi görüyor');
  perform tst_assert((select count(*) from forum_report_queue(50)) >= 1, 'moderasyon kuyruğu dolu');
end
$$;

\echo ''
\echo '── 8. Moderasyon kararları ─────────────────────────────────────────────'
reset role;
select tst_login(:FERIT) \g /dev/null
set role authenticated;
do $$
declare v_id uuid := (select id from tst_state where key = 'reported');
begin
  perform tst_assert((select count(*) from forum_report_queue(50)) = 0, 'moderatör olmayana kuyruk boş');
  begin
    perform forum_moderate(v_id, 'hide');
    perform tst_assert(false, 'moderatör olmayan karar veremmeli değil');
  exception when insufficient_privilege then
    perform tst_assert(true, 'moderatör olmayan forum_moderate çağıramıyor');
  end;
end
$$;

reset role;
select tst_login(:MOD) \g /dev/null
set role authenticated;
do $$
declare
  v_id uuid := (select id from tst_state where key = 'reported');
  r    forum_posts%rowtype;
begin
  perform forum_moderate(v_id, 'restore');
  select * into r from forum_posts where id = v_id;
  perform tst_assert(r.hidden_at is null, 'geri alma gizlemeyi kaldırıyor');
  perform tst_assert(r.report_count = 0, 'geri alma sayacı sıfırlıyor');
  perform tst_assert((select count(*) from forum_reports where post_id = v_id) = 0,
    'geri alma bildirimleri temizliyor (yoksa eşik hemen yeniden aşılırdı)');

  perform forum_moderate(v_id, 'hide');
  select * into r from forum_posts where id = v_id;
  perform tst_assert(r.hidden_at is not null and r.hidden_reason = 'moderator', 'moderatör elle gizleyebiliyor');
  perform tst_assert(r.hidden_by = '44444444-4444-4444-4444-444444444444', 'gizleyen moderatör kaydediliyor');

  perform forum_moderate(v_id, 'restore');
  perform tst_assert((select hidden_at from forum_posts where id = v_id) is null, 'ikinci geri alma da çalışıyor');

  begin
    perform forum_moderate(v_id, 'kendi-uydurduğum-işlem');
    perform tst_assert(false, 'bilinmeyen işlem reddedilmeli');
  exception when raise_exception then
    perform tst_assert(true, 'bilinmeyen moderasyon işlemi reddediliyor');
  end;
end
$$;

\echo ''
\echo '── 9. Engelleme ────────────────────────────────────────────────────────'
reset role;
select tst_login(:FERIT) \g /dev/null
set role authenticated;
do $$
begin
  insert into forum_blocks (blocked_id) values ('11111111-1111-1111-1111-111111111111');
  perform tst_assert((select count(*) from forum_blocks) = 1, 'engel kaydediliyor');

  begin
    insert into forum_blocks (blocked_id) values ('66666666-6666-6666-6666-666666666666');
    perform tst_assert(false, 'kendini engellemek reddedilmeli');
  exception when check_violation then
    perform tst_assert(true, 'kendini engellemek reddediliyor');
  end;
end
$$;

reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
do $$
begin
  perform tst_assert((select count(*) from forum_blocks) = 0, 'engel listesi sahibine özel');
end
$$;

\echo ''
\echo '── 10. Trend listesi ───────────────────────────────────────────────────'
reset role;
select tst_login(:MOD) \g /dev/null
set role authenticated;
do $$
declare
  v_id       uuid;
  v_before   bigint;
  v_after    bigint;
begin
  insert into forum_posts (body, tickers) values ('trend testi $SASA', array['SASA']) returning id into v_id;
  select posts into v_before from forum_trending_tickers(168, 50) where ticker = 'SASA';
  perform tst_assert(v_before = 1, 'etiket trend listesine giriyor');

  perform forum_moderate(v_id, 'hide');
  select posts into v_after from forum_trending_tickers(168, 50) where ticker = 'SASA';
  -- Moderatör RLS'i aşar; trend süzmesi gizlemeyi de saymazsa moderatörle
  -- diğer kullanıcılar farklı liste görürdü.
  perform tst_assert(v_after is null, 'gizli gönderi trendde sayılmıyor');

  perform forum_moderate(v_id, 'restore');
  update forum_posts set deleted_at = now() where id = v_id;
  select posts into v_after from forum_trending_tickers(168, 50) where ticker = 'SASA';
  perform tst_assert(v_after is null, 'silinen gönderi trendde sayılmıyor');
end
$$;

\echo ''
\echo '── 11. Yetkiler ────────────────────────────────────────────────────────'
reset role;
select tst_logout() \g /dev/null
set role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from forum_posts;
    perform tst_assert(false, 'anon okuma yapmamalı');
  exception when insufficient_privilege then
    perform tst_assert(true, 'anon forum_posts okuyamıyor');
  end;
  begin
    perform forum_trending_tickers(168, 5);
    perform tst_assert(false, 'anon trend RPC çağırmamalı');
  exception when insufficient_privilege then
    perform tst_assert(true, 'anon trend RPC çağıramıyor');
  end;
end
$$;

reset role;
select tst_login(:BORAN) \g /dev/null
set role authenticated;
do $$
declare n int;
begin
  begin
    perform forum_counter_bump('00000000-0000-0000-0000-000000000000', 100, 0);
    perform tst_assert(false, 'sayaç işlevi doğrudan çağrılmamalı');
  exception when insufficient_privilege then
    perform tst_assert(true, 'authenticated sayaç işlevini doğrudan çağıramıyor');
  end;
  begin
    select count(*) into n from forum_moderators;
    -- Politika yok: RLS açık tabloda okuma boş döner ya da yetki hatası verir.
    perform tst_assert(n = 0, 'moderatör listesi kullanıcıya kapalı');
  exception when insufficient_privilege then
    perform tst_assert(true, 'moderatör listesi kullanıcıya kapalı (yetki)');
  end;
  perform tst_assert(forum_is_moderator() = false, 'sıradan kullanıcı moderatör değil');
end
$$;

\echo ''
\echo '── 12. Hız sınırları ───────────────────────────────────────────────────'
-- Dakikalık sınır: 8 gönderi.
reset role;
select tst_login(:FERIT) \g /dev/null
set role authenticated;
do $$
declare i int;
begin
  for i in 1..8 loop
    insert into forum_posts (body) values ('hız testi ' || i);
  end loop;
  perform tst_assert(true, 'dakikada 8 gönderi geçiyor');
  begin
    insert into forum_posts (body) values ('dokuzuncu');
    perform tst_assert(false, 'dokuzuncu gönderi reddedilmeli');
  exception when raise_exception then
    perform tst_assert(true, 'dakikada 9. gönderi reddediliyor');
  end;
end
$$;

-- Günlük tavan: 100 gönderi. Geriye tarihli satırlar tetikleyici kapalıyken
-- yazılır, yoksa dakikalık sınır günlük sınıra hiç sıra bırakmaz.
reset role;
alter table forum_posts disable trigger forum_posts_before_insert;
alter table forum_posts disable trigger forum_posts_after_change;
insert into forum_posts (user_id, author_name, body, created_at)
select :ELIF, 'Elif Test', 'geçmiş gönderi ' || g, now() - interval '3 hours'
  from generate_series(1, 100) g;
alter table forum_posts enable trigger forum_posts_before_insert;
alter table forum_posts enable trigger forum_posts_after_change;

select tst_login(:ELIF) \g /dev/null
set role authenticated;
do $$
begin
  begin
    insert into forum_posts (body) values ('günlük tavanı aşan');
    perform tst_assert(false, 'günlük tavan aşılmamalı');
  exception when raise_exception then
    perform tst_assert(sqlerrm like '%günlük%', 'günlük tavan ayrı mesajla reddediyor: ' || sqlerrm);
  end;
end
$$;

reset role;
\echo ''
\echo '── Tüm testler geçti ───────────────────────────────────────────────────'
