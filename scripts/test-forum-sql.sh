#!/usr/bin/env bash
# docs/supabase-forum.sql'i geçici bir Postgres kümesinde sınar.
#
#   scripts/test-forum-sql.sh
#
# Yaptığı iş sırayla: geçici küme kur → Supabase taklidini yükle → v1 şemayı
# (git'ten) yükleyip üstüne bugünkü şemayı çalıştır (yükseltme yolu) → şemayı
# bir kez daha çalıştır (tekrar çalıştırılabilirlik) → davranış testlerini
# koştur. Küme her durumda silinir.
#
# Gereksinim: postgresql@17 (brew install postgresql@17). Homebrew'da bu paket
# keg-only'dur ve libpq ile çakıştığı için `brew link` çoğu makinede yarıda
# kalır. Postgres ikilileri paylaşılan dosyalarını DERLEME ANINDA gömülü mutlak
# yollarda arar (pg_config --sharedir / --pkglibdir), ikilinin yanında değil;
# bağlantılar yoksa initdb "postgres.bki yok", sunucu da "$libdir/dict_snowball
# yok" der. Script eksik iki bağlantıyı kendisi kurar ve çıkarken KENDİ
# kurduklarını geri alır.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/docs/supabase-forum.sql"
STUB="$ROOT/scripts/forum-sql/stub-supabase.sql"
TESTS="$ROOT/scripts/forum-sql/tests.sql"
# Forumun ilk sürümünü taşıyan işleme; yükseltme yolu buradan sınanır.
V1_COMMIT="${FORUM_V1_COMMIT:-2b160bf}"

find_pgbin() {
  local candidate
  for candidate in \
    /opt/homebrew/Cellar/postgresql@17/*/bin \
    /usr/local/Cellar/postgresql@17/*/bin \
    /opt/homebrew/opt/postgresql@17/bin \
    /usr/lib/postgresql/17/bin; do
    if [ -x "$candidate/initdb" ] && [ -x "$candidate/postgres" ]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v pg_ctl >/dev/null 2>&1 && command -v postgres >/dev/null 2>&1; then
    dirname "$(command -v postgres)"
    return 0
  fi
  return 1
}

PGBIN="$(find_pgbin)" || {
  echo "postgres sunucusu bulunamadı. Kurulum: brew install postgresql@17" >&2
  exit 1
}
echo "postgres: $PGBIN"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/fraude-forum-sql.XXXXXX")"
DATA="$WORK/data"
SOCKET="$WORK/sock"
mkdir -p "$SOCKET"

# Kurduğumuz geçici bağlantılar; yalnız bunlar geri alınır.
LINKS_MADE=()

cleanup() {
  if [ -d "$DATA" ]; then
    "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  local link
  for link in ${LINKS_MADE+"${LINKS_MADE[@]}"}; do
    [ -L "$link" ] && rm -f "$link"
  done
}
trap cleanup EXIT

KEG="$(cd "$PGBIN/.." && pwd)"
ensure_link() {
  local expected="$1" actual="$2"
  [ -e "$expected" ] && return 0
  [ -d "$actual" ] || return 0
  if ln -s "$actual" "$expected" 2>/dev/null; then
    LINKS_MADE+=("$expected")
    echo "  geçici bağlantı: $expected → $actual"
  else
    echo "$expected kurulamadı; 'brew link postgresql@17' gerekiyor" >&2
    exit 1
  fi
}
ensure_link "$("$PGBIN/pg_config" --sharedir)"  "$KEG/share/postgresql"
ensure_link "$("$PGBIN/pg_config" --pkglibdir)" "$KEG/lib/postgresql"

"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C.UTF-8 >"$WORK/initdb.log" 2>&1 \
  || "$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 >"$WORK/initdb.log" 2>&1 \
  || { cat "$WORK/initdb.log"; exit 1; }

# TCP kapalı: makinedeki başka bir Postgres ile port çakışması olmasın.
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCKET -h ''" -l "$WORK/server.log" -w start >/dev/null \
  || { cat "$WORK/server.log"; exit 1; }

PSQL=("$PGBIN/psql" -h "$SOCKET" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

run() { "${PSQL[@]}" -f "$1" >/dev/null; }

echo "→ Supabase taklidi"
run "$STUB"

echo "→ v1 şeması (işleme $V1_COMMIT) → yükseltme yolu"
if git -C "$ROOT" show "$V1_COMMIT:docs/supabase-forum.sql" >"$WORK/v1.sql" 2>/dev/null; then
  run "$WORK/v1.sql"
  run "$SCHEMA"
  echo "  v1 üstüne yükseltme çalıştı"
else
  echo "  atlandı: $V1_COMMIT bulunamadı, doğrudan güncel şema kuruluyor"
  run "$SCHEMA"
fi

echo "→ şema ikinci kez (tekrar çalıştırılabilirlik)"
run "$SCHEMA"

echo "→ davranış testleri"
"${PSQL[@]}" -f "$TESTS" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo "✓ forum şeması testleri geçti"
