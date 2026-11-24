# Tests — Buy Signal Alert Engine, Generic (GitHub version) — v3

## v3 test run — 2026-11-24 (Tuesday; daily data as of the Monday Nov 23 close)

v3 changes only: alert expiry (prune once the buy window closes) and the
Enable notifications status line. All v2 behaviour is unchanged; the v2
test run below still applies. No live Yahoo data was needed for the v3
checks — the prune logic was run against the shipped app.js with a fixed
"today" of 2026-11-24.

### 1. JS + Python syntax, serving, IDs

- `node --check app.js` — **OK** (69,769 bytes)
- `python3 -m py_compile scripts/eod_scan.py` — **OK**
- Local HTTP server (`python3 -m http.server`): all 12 files return
  HTTP 200 — `index.html`, `app.js`, `styles.css`, `manifest.json`,
  `sw.js`, `icon.svg`, `watchlist.json`, `README.md`, `TESTS.md`,
  `scripts/eod_scan.py`, `docs/scan-results.json`,
  `.github/workflows/eod-scan.yml`.
- Served `index.html` contains the `#notifyStatus` status-line element;
  served `app.js` contains `pruneExpired` (6 references).

### 2. Alert expiry — prune logic run against the shipped app.js

Harness (`/tmp/test_prune_v3.js`, not shipped): extracted
`recSellDate` / `pruneExpired` / `getRecs` verbatim from the shipped
`app.js`, stubbed `store` (localStorage), `todayET()` = 2026-11-24,
`HOLD_DAYS`, and `lastScan`. Seeded data:

- DIP #3, sell-by 2026-11-24 (expires today) — **kept** (still actionable)
- OLD #3, sell-by 2026-11-23 (expired) — **removed**
- ORB #6, sell-by = signal day 2026-11-23 — **removed** (gone next morning)
- VIX #2, sell-by 2026-11-30 (in window) — **kept**
- KEPT #3, sell-by 2026-11-17 but logged — **kept** (logged trades never pruned)
- LEG #4, no sellDate (legacy) — **removed** via the 5-day fallback
- Scan history: 2026-11-23 scan lost its expired AAA hit, kept BBB
  (expires today); the 2026-11-20 scan was untouched; `lastScan` was
  pruned the same way (AAA out, BBB + CCC kept).

Result: `pruneExpired()` reported 3 recs removed; all assertions
**PASSED**. Hook points verified in the shipped file: `pruneExpired()`
is called from `init()` (dashboard open), `refreshAll()` (Refresh),
`runEodScan()` (scans), `renderScanHistory()`, and inside `getRecs()`
(every alert-list read); `renderScan()` and `renderMatching()` filter
expired hits before display.

### 3. Enable notifications status line

- `index.html` has `<p id="notifyStatus" … role="status">` under the
  header buttons; the click handler sets its text for every outcome —
  granted ("Notifications are on…"), denied (blocked, with how to allow
  it in site settings), dismissed (tap to try again), unsupported.
- `requestPermission()` is wrapped in try/catch with a fallback to
  `Notification.permission`, so an embedded webview that throws still
  produces an answer. Not verified live in a browser (no browser tap
  in this run) — the live-artifact builder verified the same handler
  shape on the personal app on 2026-11-23.

## v2 test run — 2026-11-24 (Tuesday; daily data as of the Monday Nov 23 close)

All numbers are from live Yahoo Finance data fetched at test time; nothing
was invented. The v1 test run (2026-11-23) is kept below for comparison.

### 1. JS + Python syntax, serving, IDs

- `node --check app.js` — **OK** (65,794 bytes)
- `python3 -m py_compile scripts/eod_scan.py` — **OK**
- Local HTTP server (`python3 -m http.server`): `index.html`, `app.js`,
  `styles.css`, `manifest.json`, `sw.js`, `icon.svg`, `watchlist.json`,
  `docs/scan-results.json` all returned **HTTP 200**.
- Static ID check: all 67 element IDs referenced by `app.js` exist in
  `index.html` (except `logThisBtn` / `logOrbBtn`, which the JS creates
  dynamically when a hit occurs, as in v1).
- New v2 markup verified present: button text "Refresh — signals +
  current prices", `#priceStamp`, 6 `match1`–`match6` containers,
  6 gauge bars, 7 collapsed `<details>` sections (6 signal cards +
  "How the signals work"), scan summary + Show hits toggle.

### 2. Signal math — shipped `app.js`, run in Node (harness in `~/workspace/test_generic_v2.mjs`, not shipped)

The pure functions plus `fetchQuote` / `signalORB` were extracted
verbatim from the shipped `app.js` (everything before
`// ---------- Local state ----------`) and run in Node against fresh
Yahoo closes. Monday Nov 23 was a sharp up day — QQQ +7.0% and NVDA
+31.5% off the Friday Nov 20 flush — so the dip/RSI(2) hits from v1
have cleared and Bollinger bounces fired instead.

#### Signal #1 — QQQ MA-band + RSI (2026-11-23 close)

| Field | Value |
|---|---|
| QQQ close | $651.03 |
| 290-day MA | $660.70 — no touch (−1.5%) |
| 330-day MA | $650.48 — no touch (+0.1%; day low $641.95 was 1.3% below the line, outside the 1% touch band) |
| 420-day MA | $620.12 — no touch (+5.0%) |
| RSI (Wilder 14) | 42.2 — in the 35–45 dead zone, so **SKIP** if a touch occurs |

#### Signal #2 — VIX (2026-11-24 bar)

| Field | Value |
|---|---|
| VIX | 29.30 |
| Armed (≥30) | No |
| Down streak | 0 days |
| Peak in prior 10 days | 35.89 |
| 3-down-day rule / Capitulation | Not hit |

#### Signal #3 / #4 / #5 — QQQ (2026-11-23 close)

| Field | Value |
|---|---|
| Dip: lowest close, prior 63 trading days | $608.45 (the Nov 20 close is now the low) |
| Dip: % below that low | **+7.00%** — the bounce cleared the dip |
| **Dip status** | **NO SIGNAL** |
| RSI(2) | **65.2 — no hit** (was 1.75 on Nov 20) |
| Bollinger %B | −0.12 → **+0.28 — HIT** (closed below the band, then back inside), hold 5 trading days, exit **2026-12-01** |
| Bollinger bands | Lower $620.29 / Upper $730.66 |

#### Signal #3 / #4 / #5 — NVDA (2026-11-23 close)

| Field | Value |
|---|---|
| Close | $165.05 (was $125.53 on Nov 20, +31.5%) |
| Dip: lowest close, prior 63 trading days | $125.53 |
| Dip: % below that low | **+31.48% — NO SIGNAL** |
| RSI(2) | **76.1 — no hit** (was 0.17 on Nov 20) |
| Bollinger %B | −0.03 → **+0.36 — HIT**, hold 5 trading days, exit **2026-12-01** |
| Bollinger bands | Lower $127.78 / Upper $230.04 |

#### Signal #6 — ORB, QQQ, Monday 2026-11-23 (15-min bars, 131 bars fetched)

| Field | Value |
|---|---|
| Opening range (9:30–9:45am ET) | $641.95 – $656.25 |
| Breakout | **No** — last 15-min close $651.03 vs opening-range high $656.25 |
| Outcome | Correct per the rule: price never closed a 15-min bar above the range high. |

#### Trading-day exits from Monday 2026-11-23

| Hold | Exit date |
|---|---|
| +5 trading days (signals #3/#4/#5) | **2026-12-01** |
| +10 trading days (signal #1) | **2026-12-08** |
| +20 trading days (signal #2) | **2026-12-22** |

### 3. New v2 live-price path — `fetchQuote` (Yahoo `regularMarketPrice`)

Run live in Node against Yahoo (direct fetch):

- **QQQ: $651.03, as of 4:00 PM ET, source direct** — matches the Nov 23
  close exactly.
- **NVDA: $165.05, as of 4:00 PM ET, source direct** — matches the Nov 23
  close exactly.
- **Bogus ticker ZZZZNOTREAL: honest error** ("Quote fetch failed …
  HTTP 401"), no fabricated price — the app shows "Current price —"
  for unpriceable tickers.
- Price-label audit: every `fmt$` call in `app.js` now sits next to a
  label — Latest close, Current price, Signal entry price, Target buy
  price, Acceptable range, Entry price, Live price, Exit price, Trigger
  price, MA level, Band price, 3-month low close, Opening-range high/low,
  Breakout price. VIX is rendered as "Current level … — not a stock
  price".

### 4. End-of-day scan — `scripts/eod_scan.py` (signals #3–#5), run 2026-11-24

- **Scanned 30, hits 23, errors 0.** Results written to
  `docs/scan-results.json` (shipped in the zip).
- Dip hits (#3, 0): none — the Nov 23 bounce cleared every dip.
- RSI(2) hits (#4, 1): XLE.
- Bollinger bounces (#5, 22): SPY, QQQ, DIA, IWM, MSFT, NVDA, META,
  TSLA, XLK, XLF, XLI, XLY, XLB, SMH, SOXX, KRE, XBI, IBB, ARKK, QQQM,
  VOO, SCHD. A market-wide bounce day, so expect a cluster like this;
  it is not 22 independent signals.
- Note: the scan file is dated by the run day (2026-11-24) while its
  closes are Nov 23 and its exit dates are +5 trading days from the run
  day (2026-12-02); the app's own signal math dates exits from the last
  close (2026-12-01). Same quirk as v1, unchanged.

## v1 test run — 2026-11-23 (kept for comparison)

### 1. JS + Python syntax, serving

- `node --check app.js` — **OK** (52,768 bytes)
- `python3 -m py_compile scripts/eod_scan.py` — **OK**
- Local HTTP server: `index.html`, `app.js`, `manifest.json`,
  `watchlist.json`, `styles.css`, `sw.js`, `icon.svg`,
  `docs/scan-results.json` all returned **HTTP 200**.
- Tabs present: 4 `data-tab` buttons (signals / buys / calendar / trades).

### 2. Signal math — shipped `app.js`, run in Node (2026-11-20 close)

- **Signal #1 QQQ:** close $608.45; 290-day MA $660.51, 330-day $650.18,
  420-day $619.73 — no touch; RSI 26.6, FULL SIZE if a touch occurs.
- **Signal #2 VIX:** 28.02, not armed, 1-day down streak, peak 35.89 —
  no hit.
- **Signal #3/#4/#5 QQQ:** 63-day low $645.04, −5.67% — **dip HIT**,
  exit 2026-11-30; RSI(2) **1.75 — HIT**; %B −0.12 (prev 0.09) — **no
  bounce**.
- **Signal #3/#4/#5 NVDA:** close $125.53, 63-day low $145.98, −14.01%
  — **dip HIT**; RSI(2) **0.17 — HIT**; %B −0.03 — no bounce.
- **Signal #6 ORB QQQ Fri Nov 20:** opening range $633.86–$638.81,
  **breakout at 09:45** (15-min close $641.61), then closed $608.45 —
  the breakout **failed** that day, consistent with the ~45–55%
  literature win rate.
- Exits from Nov 20: +5d Nov 30, +10d Dec 7, +20d Dec 21 (Thanksgiving
  skipped).

### 3. EOD scan — v1 run 2026-11-23

- **Scanned 30, hits 35, errors 0.** Dip hits (#3, 7): QQQ, NVDA, XLK,
  SMH, SOXX, ARKK, QQQM. RSI(2) hits (#4, 28 of 30) after the Nov 20
  flush. Bollinger bounces (#5, 0).

## 5. Not tested in a real browser

- The PWA install flow, desktop notifications, the tab/Calendar/Buys
  rendering, the collapsed Details/matching-row interactions, and the
  Yahoo CORS-proxy fallbacks (allorigins / corsproxy.io) were not
  exercised in a live browser in this run — the app shows which data
  source worked and errors plainly if all three fail. Open the GitHub
  Pages site and press **Refresh — signals + current prices**; if the
  header says "Live · via direct / allorigins / corsproxy" and the
  stamp says "Current prices updated … ET", data is flowing.
- GitHub Actions workflow (`.github/workflows/eod-scan.yml`) was not run
  on GitHub yet — it runs the same `scripts/eod_scan.py` verified above.
- Signals #4–#6 have **not** been backtested on this 30-ticker universe;
  their win-rate projections are literature values (see README).
