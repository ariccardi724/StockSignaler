# Buy Signal Alert Engine — Generic (standalone GitHub version)

## What's new in v3

- **Alerts expire once their buy window closes:** an alert (and an EOD
  scan hit) is removed once today passes its sell-by date — #3 dip /
  #4 RSI(2) / #5 Bollinger after 5 trading days, #1 MA-band after 10
  (290/330-day) or 20 (420-day) days, #2 VIX after 20 days, #6 ORB at
  the same day's close (gone the next morning). An alert expiring today
  is kept — it is still actionable / sell-due today. Logged trades are
  never pruned: they are your own record, not alerts. Pruning runs
  automatically on dashboard open, Refresh, scans, and every time an
  alert list is read, so a stale alert can never be acted on days late.
  (Previously alerts vanished at midnight ET the same day, even when
  their 5/10/20-day buy window was still open.)
- **Enable notifications always answers:** tapping the button now shows
  a status line under the buttons — on, blocked (with how to allow it
  in site settings), or dismissed (tap to try again). Previously, in
  an embedded view the browser could resolve the request to "blocked"
  without showing a prompt and the tap silently did nothing.

## What's new in v2

- **Clean main page:** each signal card opens collapsed — a one-line
  description, the price, the status/signal pill, the Log trade button
  (when a signal hits), and one signal-coloured gauge bar. Everything
  else (MA band rows, dip tiers, VIX closes, thresholds, Bollinger
  values, opening-range rows) sits behind a per-card **Details**
  collapsible. The long "How the signals work" section is collapsed
  the same way.
- **Signal colours, one per signal:** #1 green, #2 violet, #3 sky blue,
  #4 yellow, #5 rose, #6 teal — card top border, dot, gauge bar, status
  pill, and matching rows all use the signal's colour.
- **Matching sublists and scan hits are compact rows:** ticker, signal
  pill, Signal entry price, and Current price at opening; date,
  sell-by, detail, and the Log button appear only when you tap a row.
  The EOD scan opens on a one-line summary ("23 hits · 30 scanned —
  22 #5 Bollinger %B · 1 #4 RSI(2)") with a Show hits button.
- **Refresh now fetches current prices:** the button is
  **"Refresh — signals + current prices"**. It re-checks the signals
  and fetches a fresh **Current price** for every matching ticker, scan
  hit, manual check, and open trade (Yahoo `regularMarketPrice`, with
  the allorigins / corsproxy fallbacks), plus a 60-second auto-refresh
  while the app is open. A "Current prices updated … ET" stamp shows
  when they were last fetched. A ticker Yahoo cannot price shows
  "Current price —", never a made-up number.
- **Every price is labelled:** Latest close, Current price, Signal
  entry price, Target buy price, Acceptable range, Entry price, Live
  price, Exit price, Trigger price, MA level, Band price, 3-month low
  close, Opening-range high/low, Breakout price, Reference close.
  VIX is labelled as a level, not a stock price.

A static, server-free app that runs from GitHub Pages. No Muse backend,
no database, no personal holdings. All state (trade log, watchlist edits,
scan history, recommendations) lives in your browser's localStorage.
All prices are fetched live from Yahoo Finance in the browser — the app
never invents prices.

## Universe (30 tickers)

- **Indexes:** SPY, QQQ, DIA, IWM
- **Mag 7:** AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA
- **Sector / industry ETFs (19):** XLK, XLF, XLV, XLE, XLI, XLP, XLY,
  XLU, XLB, XLRE, SMH, SOXX, KRE, XBI, IBB, ARKK, QQQM, VOO, SCHD

## The six signals

1. **MA-band + RSI — QQQ.** Buy at the close when QQQ touches its 290- or
   330-day moving average (day low within 1%), hold 10 trading days;
   420-day touch, hold 20 days. RSI (Wilder 14) 25–30 = full size,
   35–45 = skip (dead zone). Backtest: filtered QQQ 16 trades, 93.8% win,
   +3.92% mean.
2. **VIX 3-down-day — QQQ.** Arm when VIX closes ≥30, buy at the close of
   the 3rd straight VIX down day while VIX is still ≥25, hold 20 trading
   days. Backtest: +3.76% at 20 days, 57 episodes, 70% win. Capitulation
   variant: VIX peaked ≥40 in the prior 10 days, then 2nd down day
   (+4.79%, 81% win, 42 episodes).
3. **Dip buy — any ticker.** Buy when a stock closes 5% below its lowest
   close in the prior 63 trading days, hold 5 trading days. Sharp flush =
   close ≥2% below the low in one day. Backtest (253 held tickers, past
   year): 65.8% win, n=260, +4.6% mean. Type any ticker in the box to run
   signals #3–#5 on it.
4. **RSI(2) mean reversion.** Buy when the 2-day RSI (Wilder) drops under
   10 at the close. Exit when RSI(2) crosses back over 50, or after
   5 trading days — whichever comes first. Literature: ~70–80% win on
   index ETFs. **Not yet backtested on this universe** — treat its
   projection as literature, not a verified edge.
5. **Bollinger %B bounce.** Buy when the close was below the lower
   Bollinger Band (20-day, 2σ, %B under 0) and then closes back inside
   the band (%B 0–1). Hold 5 days. Literature: low-60s% win at 5 days.
   **Not yet backtested on this universe.**
6. **Opening range breakout, 15-min.** Buy on a 15-minute close above the
   first 15-minute bar's high (9:30–9:45am ET), hold to the close the
   same day. Intraday only — it runs during market hours, on the ticker
   you pick. Literature: ~45–55% win, winners bigger than losers.

Exits are on the clock only — no stop-loss. Stops made every backtest
worse (signals #1–#3).

## Pages / tabs

- **Signals (default):** the six signal cards, each with a small `?`
  button that explains that signal, plus the EOD scan and watchlist.
  Matching tickers/indexes are sublisted under each signal card.
- **Buys:** all of today's recommended buys in one place, each with
  signal, date, sell date, detail, and a win-rate projection. Each is a
  quick-enter order — price, shares and $ are editable and
  cross-computed. Log it and it moves to the Trade Log and the Calendar.
  Don't log it and it disappears at midnight ET.
- **Calendar:** sell events are placed automatically from logged buys,
  on that signal's clock exit. Possible buys (today's recommendations)
  appear as editable rows on today's date and disappear at midnight ET
  if you don't log them. Month view is a clickable grid (each day shows
  its sell/buy counts); click a day to expand it. Week view lists each
  of the 7 days with its sell count and tickers.
- **Trade Log:** log ticker, signal, entry date, entry price, shares or
  dollar amount. The app sets the sell target date — entry + 5 / 10 /
  20 trading days for signals #3/#4/#5, #1, #2; signal #6 sells at the
  close the same day — skipping weekends and US market holidays
  (2026–2027 list is in `app.js`). Shows a countdown, the live price
  for open trades, and the outcome once you record an exit.
  Export/import as JSON.

## Put it on GitHub (step by step)

1. Create a new repo on GitHub (any name, e.g.
   `buy-signal-alert-engine-generic`), public or private — Pages works
   on both for your own use.
2. Upload the contents of this zip to the repo root, so `index.html` is at
   the top level. Either drag-and-drop in the GitHub web UI, or:
   ```bash
   git init
   git add .
   git commit -m "Buy Signal Alert Engine - Generic"
   git branch -M main
   git remote add origin https://github.com/<you>/buy-signal-alert-engine-generic.git
   git push -u origin main
   ```
3. Enable Pages: repo **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: main, Folder: /(root) → Save.**
4. Wait a minute, then open the site at
   `https://<you>.github.io/buy-signal-alert-engine-generic/` (the URL is
   shown on the Pages settings page).
5. Click **Enable notifications** in the app header if you want desktop
   alerts when a signal hits while the app is open.

## Pin it to desktop / Start screen (install as an app)

The app is a PWA (`manifest.json` + service worker), so it installs like
an app:

- **Windows, Chrome/Edge:** open the site, click the install/computer icon
  in the address bar, or menu → **Save and share → Install page as app**
  (Edge) / **Install app** (Chrome). It then appears in Start and can be
  pinned to the taskbar. It opens standalone, in its own window.
- **Windows, Firefox:** use Chrome or Edge for the install, or create a
  desktop shortcut to the site URL.
- **Mac, Chrome:** same install icon in the address bar; it lands in
  Applications / Launchpad.
- **iPhone/iPad, Safari:** Share → **Add to Home Screen**. It opens
  full-screen with its own icon.
- **Android, Chrome:** menu → **Add to Home screen** / **Install app**.

## How it works

- **Live data:** the browser fetches Yahoo Finance v8 chart data
  (`query1.finance.yahoo.com`), adjusted closes for daily signals and
  15-minute bars for signal #6. Yahoo blocks cross-site requests, so
  the app tries in order: direct fetch, then `api.allorigins.win`,
  then `corsproxy.io`. The header shows which source worked and when
  data was last updated. If all three fail, it says so plainly — it
  never shows made-up prices.
- **End-of-day scan:** on open after 4:15pm ET (and on demand with the
  button), the app scans the 30-ticker generic universe in
  `watchlist.json` for signals #3, #4, and #5. Scan history is saved in
  localStorage. The GitHub Actions workflow
  (`.github/workflows/eod-scan.yml`, Mon–Fri 21:15 UTC) runs the same
  scan server-side and writes `docs/scan-results.json`, which the app
  can load with **Load latest GitHub Actions scan**.
- **Trade log / calendar:** see "Pages / tabs" above. Recommendations
  are never saved past midnight ET — only logged trades persist.
- **Notifications:** a fresh hit fires an in-app banner, a sound
  (WebAudio beep), and a desktop notification if you granted
  permission. Notifications only fire while the app is open — a static
  site cannot alert you while closed. The GitHub Actions EOD scan is
  the workaround for after-hours: its results are waiting in the app
  when you next open it.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app page (Signals / Buys / Calendar / Trade Log tabs) |
| `app.js` | All signal math, fetching, scan, recommendations, calendar, trade log |
| `styles.css` | Robinhood-style dark theme |
| `manifest.json`, `sw.js`, `icon.svg` | PWA install + offline app shell |
| `watchlist.json` | Generic universe: 4 indexes, Mag 7, 19 sector/industry ETFs |
| `scripts/eod_scan.py` | The EOD scan (signals #3–#5), run by GitHub Actions |
| `.github/workflows/eod-scan.yml` | Mon–Fri 21:15 UTC scan schedule |
| `docs/scan-results.json` | Latest scan (run 2026-11-24, 30 scanned, 23 hits) |
| `TESTS.md` | How it was tested, with real numbers |

## Limitations (honest)

- **CORS proxies:** Yahoo blocks direct browser fetches, so the app depends
  on allorigins / corsproxy.io as fallbacks. If Yahoo changes its API or a
  proxy goes down, live data stops until a working source is found — the
  app will tell you, not fake it.
- **No background alerts:** GitHub Pages cannot run code while the app is
  closed. Alerts fire while the app is open; the EOD scan file covers
  after-hours.
- **Signals #4–#6 are literature, not backtested here:** their win-rate
  projections come from published Connors / Bollinger / ORB studies, not
  from a backtest on this 30-ticker universe. Signal #4 fired on 27 of
  30 tickers on 2026-11-23 after a market-wide flush — RSI(2) is very
  sensitive on sharp down days, so expect clusters like that.
- **Signal #6 needs market hours:** the opening range only exists
  9:30–9:45am ET. Outside market hours it reports the last trading
  day's range.
- **Backtests only:** past win rates are not a future guarantee. The app
  places no trades.

## Test results

See `TESTS.md` — v2 signal math was run in Node against live Yahoo data
on 2026-11-24 (QQQ Nov 23 close $651.03: no MA touch, RSI 42.2 dead
zone, VIX 29.30 not armed, Bollinger %B bounce HIT for QQQ and NVDA
with exit 2026-12-01; ORB QQQ Mon Nov 23: range $641.95–$656.25, no
breakout), the new `fetchQuote` current-price path was verified live
(QQQ $651.03, NVDA $165.05, bogus ticker returns an honest error, no
fake price), and the JS was syntax-checked with `node --check`.
