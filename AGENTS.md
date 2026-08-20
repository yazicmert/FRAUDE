# Repository agent workflow

## Branching, merging, releasing

- Work on a branch and land it through a pull request: `gh pr create --base main` then `gh pr merge <n> --squash`. Never push to `main` directly and never force-push a branch that has been pushed. `main` history is a flat list of squashed PR commits (`subject (#n)`); preserve that shape.
- To bring a branch up to date with `main`, merge `origin/main` into it. Do not rebase a pushed branch: rebasing requires a force-push, and the squash merge discards the intermediate merge commit anyway.
- `[build]` in a commit subject triggers the CI version stamp and the macOS/Windows release build. Put it in the squash subject only when a release is actually intended; a plain feature merge must not carry it.
- Merging to `main` publishes: entries in `updates/registry.json` become visible on the public `/guncellemeler` page and in the in-app Updates module. The merge itself is the approval gate — review the entry text, not just the code.
- Verify before opening the PR, since CI does not run the full matrix: `npx tsc --noEmit`, `npm run build`, `cargo test --manifest-path core/Cargo.toml --lib`, and `cargo check --manifest-path src-tauri/Cargo.toml`. The Tauri crate must be checked separately — a closure passed into an async task can compile in `core` and fail only at the Tauri command boundary with "implementation of `FnOnce` is not general enough".

## Community updates registry

- Every user-visible change adds one entry to `updates/registry.json`, newest first, with `includedIn: null` until a release stamps it.
- Because every entry is prepended, **parallel branches always conflict on the first array element** — expect it on every second merge. Do not hand-merge the conflict markers: the hunk shape differs per branch (one side is frequently empty) and text merging silently corrupts the file.
- Resolve at the JSON level instead: load `origin/main`'s copy, insert your entry at index 0, and write it back with `json.dumps(data, ensure_ascii=False, indent=2)` plus a trailing newline. That round-trip reproduces the committed file byte-for-byte, so the diff stays limited to the new entry. Afterwards assert that ids are unique.

## Rust/Cargo build artifacts

- `core`, `server`, and `src-tauri` share the repository-root `target/` directory through `.cargo/config.toml`. Do not set `CARGO_TARGET_DIR` or create per-crate target directories.
- Run Cargo commands from the repository root with an explicit manifest path, for example `cargo check --manifest-path core/Cargo.toml`.
- Prefer `cargo check` while iterating. Do not run `check`, `build`, `test`, and `release` variants for the same change unless each variant is required by the acceptance criteria.
- Use `npm run rust:check` when all three Rust crates need validation. It checks `core`, `src-tauri`, and `server` against the shared artifact cache.
- Use `npm run tauri dev` for desktop development. Reserve `npm run tauri build` and Cargo release builds for packaging or explicit release verification.
- Development and test profiles intentionally use reduced debug information and disable incremental artifacts to keep disk use bounded. Do not override these settings without documenting the disk/build-time tradeoff.
- The root `target/` is generated and ignored by Git. If it grows beyond 10 GiB, the disk is low, or the user requests cleanup, run `npm run rust:clean`. This cleans the shared Cargo cache; do not manually delete source or lock files.
- Before and after a cleanup, use `du -sh target 2>/dev/null` and `df -h .` to report the actual space impact when disk usage is relevant.

## Network layer

- All outbound requests must go through the shared client from `fraude_core::http_client()` (reachable as `state.http`). Never construct a bare `reqwest::Client::new()` in a module: it opts out of the shared connection pool and re-runs the TLS handshake on every call.
- Compression is configured once on that client. Every provider FRAUDE talks to serves gzip but returns plain text unless `Accept-Encoding` is sent — measured savings: KAP company list 1.52 MB → 206 KB, İş Yatırım daily series 160 KB → 59 KB, Yahoo 1-year chart 14.9 KB → 5.1 KB. No provider offers brotli, so that codec is deliberately not enabled.
- `pool_idle_timeout` is deliberately below reqwest's 90 s default because İş Yatırım closes idle keep-alive connections much earlier; a longer window hands out dead pooled connections. Keep `pool_max_idle_per_host` at or above the highest per-provider concurrency (currently Yahoo's 8).
- A cache whose refresh costs more than one request must serialize its refreshes (single-flight): check the cache, take an async lock, then check again before going to the network. `isyatirim::load_ratios` (5 requests) and `yahoo::fetch_market_metrics` (17 requests) follow this shape.
- Cache failures, not just successes. An unresolvable symbol re-requested on every poll costs the same as a live one; see `live_quotes::FAILURE_TTL`.
- The market universe is persisted by `market_cache` so a restart does not repeat the ~650-request full sync. Advance the stored full-sync timestamp only on a sync that actually met the coverage threshold — partial rounds may be written, but must not defer the next full sync.

## Marketing site (`site/`)

- The site is a separate npm project. Verify it with `npm run build` **inside `site/`** (that runs `tsc` first); the repository-root build does not cover it.
- Page metadata has exactly one source: `site/src/lib/seo.ts`. `lib/useSeo.ts` applies it in the browser and `scripts/prerender.ts` writes the same tags into static HTML at build time. Never hand-edit `<title>`/`<meta>` in a page component — social preview crawlers do not run JavaScript, so anything only set at runtime is invisible to them.
- Every route emitted by `publicPaths()` gets its own `dist/<path>.html` plus a `sitemap.xml` entry. Adding a module to `lib/product.ts` therefore extends both automatically; no separate sitemap edit is needed.
- Tags written by either side carry `data-seo`. The runtime clears all `[data-seo]` nodes before rewriting, which is what keeps prerendered and client-side metadata from duplicating. A new tag without that attribute will accumulate on every navigation.
- `index.html` must keep its `<!-- seo:start -->` / `<!-- seo:end -->` markers: the prerender step replaces that block and fails the build if the markers are missing.
- `pages/AppHandoff.tsx` and `pages/Landing.tsx` are statically imported on purpose; every other route is `lazy()`. AppHandoff reads the auth token out of the URL hash in its module body and must run before supabase-js initialises, so do not convert it to a lazy route.
- supabase-js is loaded on demand. `useSession(eager)` skips the import entirely on marketing routes when no `sb-*-auth-token` key exists in local storage; pass `eager` for any route that must know the session for certain.
- `vercel.json` sets `cleanUrls` (so `dist/modul/pano.html` serves at `/modul/pano`) and a CSP whose `connect-src` lists every origin the site fetches. Adding a new `fetch()` target means adding its origin there, or it is blocked in production.

## KAP financial archive (`scripts/kap/`, migration `20260818000005`)

- The archive is written **only** by `scripts/kap` running with `SUPABASE_SERVICE_KEY`. The anon key is embedded in the shipped desktop binary, so `anon` has `select` and nothing else; any client-side write path is a bug, not an optimisation. `core/src/kap.rs` deliberately does not persist the live quarter it fetches.
- KAP publishes flow items (revenue, profit, cash flow) **cumulative from the start of the year** — a Q2 report's revenue is six months. `bist_financial_statements` therefore stores `_ytd` and `_q` separately, and the two must never be read from one column.
- Read through the `bist_financial_quarters` view, never off the base table. It carries the derived quarterly value (reported 3-month column, else the cumulative difference) **and** the `_ytd` passthroughs, so one query builds both series. The annual series comes from `_ytd` on the Q4 row; taking the quarter column there yields Q4-only figures.
- Cumulative differencing is partitioned by year. Any new derived column in that view must go inside `window w`, or Q1 silently subtracts the previous year's total.
- A company publishes both consolidated and solo statements for the same period (AKBNK 2024/Q4: 2.65 trn vs 2.52 trn TL), so `consolidation` is part of the primary key. Readers pick per period — consolidated when present, else solo — because companies that only later formed subsidiaries would otherwise lose their early years.
- Rows are matched by XBRL **concept name** (`ifrs-full_Revenue`), never by the Turkish label: a single disclosure has 700+ rows across 5-6 tables and labels repeat with different values. Banks use their own taxonomy (`kap-fr_InterestIncome`, `banks_role_*`) and split every period into TP | YP | Toplam sub-columns.
- Two concept names in `concepts.py` carry KAP's own typos (`kap-fr_CurrentBorowings`, `ifrs-full_LongtermBorrowings`) and must not be "corrected".
- The skip decision reads the `kap_disclosures` ledger by disclosure number, not by a period guessed from the publish date — delayed and restated reports break that guess. `parsed` and `unparsable` are both skipped at the current `PARSER_VERSION`; bumping the version requeues everything automatically.
- Parser changes are regression-tested against real gzipped KAP pages in `scripts/kap/tests/fixtures`. Run `python3 -m kap.tests.test_xbrl` from `scripts/`, and `scripts/kap/tests/run-schema-tests.sh` (needs Docker) for the SQL behaviour suite.

## Market data architecture

- Keep provider symbols canonical in storage and APIs (`GC=F`, `USDTRY=X`, `BTC-USD`, bare BIST equity codes). Human-readable labels belong in `name`; do not use display labels as cache or merge keys.
- Route live prices by instrument type: BIST equities use İş Yatırım, while global equities, indices, FX, commodities, and crypto use Yahoo Finance. Synthetic gram metals are derived from the matching ounce contract and USD/TRY at both current and previous-close bases.
- Do not tie non-BIST polling to Borsa İstanbul session hours. Crypto and other non-BIST instruments must continue refreshing according to their own provider availability.
- A sync is successful only when it updates market rows. Full-sync freshness may be recorded only when coverage meets the threshold in `services::full_sync_is_acceptable`; partial results merge into the store without shrinking the existing universe.
- Treat `as_of_ts` as market-data freshness and `DashboardSnapshot.generated_at` as response-generation time. Do not replace missing provider timestamps with a successful-sync timestamp unless the provider observation itself was made at that time.
- When adding an index, equity class, FX pair, commodity, or crypto asset, update the canonical backend universe and the frontend symbol catalog/group classifier together, then cover routing, change calculation, timestamp, and expected-card-count behavior with tests.
