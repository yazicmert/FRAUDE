#!/usr/bin/env bash
# KAP boru hattı v2 şemasını geçici bir Postgres kabında sınar.
#
#   scripts/kap/tests/run-schema-tests.sh
#
# Sırayla: kap başlat → Supabase rollerini taklit et → v1 göçlerini yükle →
# v2 göçünü çalıştır → v2 göçünü bir kez daha çalıştır (tekrar
# çalıştırılabilirlik) → davranış testlerini koştur. Kap her durumda silinir.
#
# Gereksinim: çalışan bir Docker. Yerel bir Postgres sunucusu gerekmiyor;
# scripts/test-forum-sql.sh'in aksine bu script kap kullanıyor çünkü
# postgresql@17 Homebrew'da keg-only ve çoğu makinede bağlantısı yarım kalıyor.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/schema_tests.sql"
IMAGE="${FRAUDE_PG_IMAGE:-postgres:15}"
CONTAINER="fraude-kap-schema-test-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || {
  echo "Docker çalışmıyor. Docker Desktop'ı başlatın." >&2
  exit 1
}

echo "postgres kabı başlatılıyor ($IMAGE)"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null

run_sql() {
  docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q
}

echo "Supabase rolleri taklit ediliyor"
run_sql <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists auth;
SQL

for migration in \
  20260818000002_bist_financial_periods \
  20260818000003_bist_universe_and_reconcile \
  20260818000004_fix_bist_financials_permissions_and_rpc
do
  echo "v1 göçü: $migration"
  run_sql < "$MIGRATIONS/$migration.sql" >/dev/null
done

echo "v2 göçü uygulanıyor"
run_sql < "$MIGRATIONS/20260818000005_kap_pipeline_v2.sql" >/dev/null

echo "v2 göçü yeniden uygulanıyor (tekrar çalıştırılabilirlik)"
run_sql < "$MIGRATIONS/20260818000005_kap_pipeline_v2.sql" >/dev/null

echo "davranış testleri"
output="$(run_sql < "$TESTS" 2>&1)"
echo "$output" | grep -E "ok:|BASARISIZ" | sed 's/^NOTICE:  //'

if echo "$output" | grep -q "TUM SEMA TESTLERI GECTI"; then
  echo
  echo "$(echo "$output" | grep -c 'ok:') şema testi geçti."
else
  echo "$output" >&2
  exit 1
fi
