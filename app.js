'use strict';
/* Buy Signal Alert Engine — static GitHub Pages version, v3.
   All data fetched live from Yahoo Finance in the browser.
   All state in localStorage. No server, no fake data.
   v3: alerts (and EOD scan hits) are pruned once their buy window
   closes — dip / RSI(2) / Bollinger after 5 trading days, MA-band
   after 10/20 days, VIX after 20 days, ORB at the same day's close.
   v3: the Enable notifications button always answers with a status
   line under the buttons (on / blocked / dismissed). */

const $ = (id) => document.getElementById(id);
const fmt$ = (n) => n == null || isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtPct = (n) => n == null || isNaN(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------- US market holidays 2026-2027 (NYSE) ----------
const HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19',
  '2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18',
  '2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);
function isTradingDay(d) { // d is a Date (local)
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return !HOLIDAYS.has(iso);
}
function addTradingDays(dateISO, n) {
  const d = new Date(dateISO + 'T12:00:00');
  let left = n;
  while (left > 0) { d.setDate(d.getDate() + 1); if (isTradingDay(d)) left--; }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tradingDaysBetween(aISO, bISO) {
  const a = new Date(aISO + 'T12:00:00'), b = new Date(bISO + 'T12:00:00');
  let n = 0; const d = new Date(a);
  while (d < b) { d.setDate(d.getDate() + 1); if (isTradingDay(d)) n++; }
  return n;
}

// ---------- v2: signal colours + live (current) prices ----------
const SIGNAL_COLORS = {'1': '#00c805', '2': '#8b5cf6', '3': '#38bdf8', '4': '#facc15', '5': '#fb7185', '6': '#2dd4bf'};
const SIGNAL_NAMES = {'1': 'MA-band + RSI', '2': 'VIX 3-down-day', '3': 'Dip buy', '4': 'RSI(2)', '5': 'Bollinger %B', '6': 'ORB 15-min'};
let livePrices = {}; // ticker -> {price, asOf, source}; refreshed by the Refresh button + every 60s
let lastScan = null;
let scanOpen = false;
let lastDipTicker = null, lastOrbTicker = null;

function prefillTrade(ticker, signal, date, price) {
  $('logTicker').value = ticker; $('logSignal').value = String(signal);
  $('logDate').value = date; $('logPrice').value = price != null ? Number(price).toFixed(2) : '';
  showTab('trades');
  $('logTradeBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function setPill(id, text, cls) {
  const el = $(id); if (!el) return;
  el.textContent = text; el.className = 'pill ' + (cls || 'no');
}
function setGauge(id, capId, frac, capText) {
  const g = $(id); if (g) g.style.width = Math.max(0, Math.min(1, frac || 0)) * 100 + '%';
  const c = $(capId); if (c) c.textContent = capText;
}

// ---------- Yahoo fetch with CORS fallbacks ----------
let lastDataSource = '—';
async function fetchYahoo(symbol, range = '2y') {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=' + range + '&interval=1d';
  const attempts = [
    ['direct', url],
    ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)],
    ['corsproxy', 'https://corsproxy.io/?url=' + encodeURIComponent(url)],
  ];
  let lastErr = null;
  for (const [name, u] of attempts) {
    try {
      const res = await fetch(u, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const result = data && data.chart && data.chart.result && data.chart.result[0];
      if (!result || !result.timestamp) throw new Error('No price data returned for ' + symbol);
      lastDataSource = name;
      return parseChart(result);
    } catch (e) { lastErr = e; }
  }
  throw new Error('Yahoo fetch failed for ' + symbol + ' (direct, allorigins, corsproxy all failed): ' + (lastErr && lastErr.message));
}
function parseChart(result) {
  const ts = result.timestamp;
  const q = result.indicators.quote[0];
  const adj = result.indicators.adjclose ? result.indicators.adjclose[0].adjclose : q.close;
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (adj[i] == null || q.close[i] == null) continue;
    rows.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], adj: adj[i],
      volume: q.volume ? q.volume[i] : null,
    });
  }
  if (rows.length < 30) throw new Error('Too few price bars returned (' + rows.length + ')');
  return rows;
}

// ---------- Live quote (current price) ----------
async function fetchQuote(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1m&includePrePost=false';
  const attempts = [
    ['direct', url],
    ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)],
    ['corsproxy', 'https://corsproxy.io/?url=' + encodeURIComponent(url)],
  ];
  let lastErr = null;
  for (const [name, u] of attempts) {
    try {
      const res = await fetch(u, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const result = data && data.chart && data.chart.result && data.chart.result[0];
      if (!result || !result.meta) throw new Error('No quote for ' + symbol);
      const meta = result.meta;
      let price = meta.regularMarketPrice;
      let asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : null;
      if (price == null && result.timestamp && result.indicators && result.indicators.quote) {
        const closes = result.indicators.quote[0].close;
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] != null) { price = closes[i]; asOf = new Date(result.timestamp[i] * 1000); break; }
        }
      }
      if (price == null) throw new Error('No price for ' + symbol);
      lastDataSource = name;
      return { price, asOf: asOf ? asOf.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : '—', source: name };
    } catch (e) { lastErr = e; }
  }
  throw new Error('Quote fetch failed for ' + symbol + ': ' + (lastErr && lastErr.message));
}
function livePriceLine(ticker, signalPrice) {
  const q = livePrices[ticker];
  if (!q) return '<span class="small">Current price —</span>';
  const chg = signalPrice ? ((q.price / signalPrice - 1) * 100) : null;
  return '<span class="small">Current price ' + fmt$(q.price) + (chg != null ? ' (' + fmtPct(chg) + ' vs signal)' : '') + '</span>';
}
function targetRange(price) {
  if (price == null) return '—';
  return fmt$(price * 0.99) + ' – ' + fmt$(price * 1.01);
}
function updatePriceStamp() {
  const el = $('priceStamp'); if (!el) return;
  el.textContent = 'Current prices updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
}
function updateCurrentPriceLines() {
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  const q = livePrices['QQQ'];
  const qLine = q ? 'Current price ' + fmt$(q.price) + ' · as of ' + q.asOf : 'Current price —';
  set('qqqCurrent', qLine); set('rsi2Current', qLine); set('bbCurrent', qLine);
  if (lastDipTicker && livePrices[lastDipTicker]) set('dipCurrent', 'Current price ' + fmt$(livePrices[lastDipTicker].price) + ' · as of ' + livePrices[lastDipTicker].asOf);
  if (lastOrbTicker && livePrices[lastOrbTicker]) set('orbCurrent', 'Current price ' + fmt$(livePrices[lastOrbTicker].price) + ' · as of ' + livePrices[lastOrbTicker].asOf);
}
function allLiveTickers() {
  const s = new Set(['QQQ']);
  try { getRecs().forEach((r) => s.add(r.ticker)); } catch (e) {}
  if (lastScan) lastScan.hits.forEach((h) => s.add(h.ticker));
  try { getTrades().forEach((t) => s.add(t.ticker)); } catch (e) {}
  if (lastDipTicker) s.add(lastDipTicker);
  if (lastOrbTicker) s.add(lastOrbTicker);
  return [...s];
}
async function refreshLivePrices(tickers) {
  const list = [...new Set((tickers || []).filter(Boolean))];
  if (!list.length) return;
  await Promise.all(list.map(async (t) => {
    try { livePrices[t] = await fetchQuote(t); } catch (e) { /* keep any older price; row shows "Current price —" */ }
  }));
  updatePriceStamp(); updateCurrentPriceLines();
  renderBuys(); renderTrades();
  if (lastScan) renderScan(lastScan);
}

// ---------- Math: Wilder RSI, MAs ----------
function rsiWilder(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  let ag = gain / period, al = loss / period;
  rsi[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}
function sma(values, period) {
  if (values.length < period) return null;
  let s = 0; for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

// ---------- Signal computations (pure, testable) ----------
function signalMA(rows) {
  const closes = rows.map((r) => r.adj);
  const last = rows[rows.length - 1];
  const rsi = rsiWilder(closes)[rows.length - 1];
  const out = { date: last.date, close: last.close, low: last.low, rsi, bands: [] };
  for (const p of [290, 330, 420]) {
    const ma = sma(closes, p);
    if (ma == null) continue;
    const touch = Math.abs(last.low - ma) / ma <= 0.01;
    const hold = p === 420 ? 20 : 10;
    out.bands.push({ period: p, ma, touch, hold,
      distancePct: (last.close / ma - 1) * 100,
      exitDate: touch ? addTradingDays(last.date, hold) : null });
  }
  out.hit = out.bands.some((b) => b.touch);
  out.size = rsi != null && rsi >= 25 && rsi <= 30 ? 'FULL SIZE' : (rsi != null && rsi >= 35 && rsi <= 45 ? 'SKIP — dead zone' : 'STANDARD SIZE');
  return out;
}
function signalVIX(rows) {
  const closes = rows.map((r) => r.adj);
  const last = closes[closes.length - 1];
  let streak = 0;
  for (let i = closes.length - 1; i > 0; i--) { if (closes[i] < closes[i - 1]) streak++; else break; }
  const peak10 = Math.max.apply(null, closes.slice(-11, -1));
  const armed = last >= 30;
  const hit = armed && streak >= 3 && last >= 25;
  const capitulation = peak10 >= 40 && streak >= 2;
  return { date: rows[rows.length - 1].date, close: last, streak, peak10, armed,
    hit, capitulation, hold: 20,
    exitDate: (hit || capitulation) ? addTradingDays(rows[rows.length - 1].date, 20) : null };
}
function signalDip(rows) {
  const closes = rows.map((r) => r.adj);
  const last = rows[rows.length - 1];
  const prior = closes.slice(-64, -1); // 63 trading days before the last day
  const low63 = Math.min.apply(null, prior);
  const pctBelow = (last.adj / low63 - 1) * 100;
  const dayRet = (last.adj / closes[closes.length - 2] - 1) * 100;
  const sharp = last.adj < low63 && (low63 - last.adj) / low63 >= 0.02;
  const rsi = rsiWilder(closes)[rows.length - 1];
  const hit = last.adj <= low63 * 0.95;
  const status = hit ? 'HIT' : (last.adj <= low63 * 1.02 ? 'CLOSE' : 'NO SIGNAL');
  return { date: last.date, close: last.adj, low63, pctBelow, dayRet, sharp, rsi,
    hit, status, hold: 5, exitDate: hit ? addTradingDays(last.date, 5) : null };
}

// ---------- Signals #4, #5, #6 (pure, testable) ----------
function signalRSI2(rows) {
  const closes = rows.map((r) => r.adj);
  const rsi2 = rsiWilder(closes, 2);
  const last = rsi2[rsi2.length - 1];
  const hit = last != null && last < 10;
  return { date: rows[rows.length - 1].date, close: rows[rows.length - 1].adj, rsi2: last,
    hit, hold: 5, exitDate: hit ? addTradingDays(rows[rows.length - 1].date, 5) : null,
    exitRule: 'exit when RSI(2) crosses over 50, or by ' + (hit ? addTradingDays(rows[rows.length - 1].date, 5) : '—') };
}
function bollinger(closes, period = 20, mult = 2) {
  if (closes.length < period + 1) return null;
  const out = [];
  for (let end = period; end <= closes.length; end++) {
    const w = closes.slice(end - period, end);
    const mean = w.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period);
    out.push({ mean, upper: mean + mult * sd, lower: mean - mult * sd,
      pctB: sd === 0 ? 0.5 : (closes[end - 1] - (mean - mult * sd)) / (2 * mult * sd) });
  }
  return out;
}
function signalBollinger(rows) {
  const closes = rows.map((r) => r.adj);
  const bb = bollinger(closes);
  if (!bb || bb.length < 2) return { hit: false, pctB: null, date: rows[rows.length - 1].date };
  const today = bb[bb.length - 1], yest = bb[bb.length - 2];
  const hit = yest.pctB < 0 && today.pctB >= 0 && today.pctB <= 1;
  return { date: rows[rows.length - 1].date, close: rows[rows.length - 1].adj,
    pctB: today.pctB, prevPctB: yest.pctB, upper: today.upper, lower: today.lower,
    hit, hold: 5, exitDate: hit ? addTradingDays(rows[rows.length - 1].date, 5) : null };
}
function signalORB(bars) {
  // bars: [{date, time, open, high, low, close}] chronological, 15-min.
  if (!bars || bars.length < 3) return { hit: false, status: 'Not enough intraday bars yet.' };
  const lastDate = bars[bars.length - 1].date;
  const dayBars = bars.filter((b) => b.date === lastDate);
  if (dayBars.length < 2) return { hit: false, date: lastDate, status: 'Opening range still forming.' };
  const orHigh = dayBars[0].high, orLow = dayBars[0].low;
  let breakout = null;
  for (let i = 1; i < dayBars.length; i++) {
    if (dayBars[i].close > orHigh) { breakout = dayBars[i]; break; }
  }
  const last = dayBars[dayBars.length - 1];
  return { date: lastDate, orHigh, orLow, lastClose: last.close,
    hit: !!breakout, breakoutPrice: breakout ? breakout.close : null,
    breakoutTime: breakout ? breakout.time : null,
    status: breakout ? 'BREAKOUT above opening-range high ' + fmt$(orHigh) + ' at ' + breakout.time + ' — hold to the close.'
      : 'No breakout yet — last 15-min close ' + fmt$(last.close) + ' vs opening-range high ' + fmt$(orHigh) + '.' };
}

// ---------- Intraday fetch (15-min bars, for signal #6) ----------
async function fetchIntraday(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=5d&interval=15m&includePrePost=false';
  const attempts = [
    ['direct', url],
    ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)],
    ['corsproxy', 'https://corsproxy.io/?url=' + encodeURIComponent(url)],
  ];
  let lastErr = null;
  for (const [name, u] of attempts) {
    try {
      const res = await fetch(u, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const result = data && data.chart && data.chart.result && data.chart.result[0];
      if (!result || !result.timestamp) throw new Error('No intraday data for ' + symbol);
      lastDataSource = name;
      const ts = result.timestamp, q = result.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        const d = new Date(ts[i] * 1000);
        bars.push({ date: d.toISOString().slice(0, 10), time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }),
          open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
      }
      return bars;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Intraday fetch failed for ' + symbol + ': ' + (lastErr && lastErr.message));
}

// ---------- Local state ----------
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('bsae:' + k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bsae:' + k, JSON.stringify(v)); } catch (e) {} },
};
let watchlist = store.get('watchlist', null); // null = use embedded watchlist.json
let alertedKeys = new Set(store.get('alertedKeys', []));

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'buys') renderBuys();
  if (name === 'calendar') renderCalendar();
}
document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Help (?) buttons ----------
document.querySelectorAll('.helpbtn').forEach((b) => b.addEventListener('click', () => {
  const box = $('helpBox');
  if (box) {
    box.style.display = box.style.display === 'none' || box.dataset.key !== b.dataset.help ? 'block' : 'none';
    box.dataset.key = b.dataset.help;
    box.textContent = HELP_TEXT[b.dataset.help] || '';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    alert(HELP_TEXT[b.dataset.help] || '');
  }
}));

// ---------- Alert expiry (v3): prune once the buy window closes ----------
// Mirrors the live app's prune: an alert's buy window runs from its signal
// date through its sell-by date (sellDate / exitDate) inclusive. Once today
// (ET) is past the sell-by date the opportunity is over and the alert is
// removed — #3 dip / #4 RSI(2) / #5 Bollinger after 5 trading days,
// #1 MA-band after 10 (290/330-day) or 20 (420-day) days, #2 VIX after
// 20 days, #6 ORB at the same day's close (sellDate == signal date, so it
// is gone the next morning). An alert expiring today is kept — still
// actionable / sell-due today. Logged trades are never pruned: they are
// the user's own record, not alerts. The same rule prunes EOD scan hits
// (exitDate) from the saved scan history and from the scan on screen.
function recSellDate(r) {
  if (r.sellDate) return r.sellDate;
  return addTradingDays(r.date, HOLD_DAYS[String(r.signal)] || 5);
}
function pruneExpired() {
  const today = todayET();
  const recs = store.get('recommendations', []);
  const keptRecs = recs.filter((r) => r.logged || recSellDate(r) >= today);
  if (keptRecs.length !== recs.length) store.set('recommendations', keptRecs);
  const history = store.get('scanHistory', []);
  let historyChanged = false;
  const prunedHistory = history.map((s) => {
    const hits = (s.hits || []).filter((h) => (h.exitDate || s.date) >= today);
    if (hits.length !== (s.hits || []).length) { historyChanged = true; return Object.assign({}, s, { hits }); }
    return s;
  });
  if (historyChanged) store.set('scanHistory', prunedHistory);
  if (typeof lastScan !== 'undefined' && lastScan && lastScan.hits) {
    lastScan.hits = lastScan.hits.filter((h) => (h.exitDate || lastScan.date) >= today);
  }
  return { recsRemoved: recs.length - keptRecs.length };
}

// ---------- Recommendations (kept while their buy window is open) ----------
function getRecs() {
  pruneExpired(); // alerts whose buy window closed are gone (see pruneExpired)
  const all = store.get('recommendations', []);
  return all.filter((r) => !r.logged);
}
function addRec(rec) {
  const all = store.get('recommendations', []);
  const key = rec.ticker + '|' + rec.signal + '|' + rec.date;
  if (all.some((r) => (r.ticker + '|' + r.signal + '|' + r.date) === key && !r.logged)) return;
  all.unshift(Object.assign({ id: Date.now() + Math.floor(Math.random() * 1000), logged: false }, rec));
  store.set('recommendations', all.slice(0, 200));
  updateCounts();
}
function markRecLogged(id) {
  const all = store.get('recommendations', []);
  const rec = all.find((r) => r.id === id);
  if (rec) rec.logged = true;
  store.set('recommendations', all);
  updateCounts();
}
function updateCounts() {
  const n = getRecs().length;
  const bc = $('buysCount'); if (bc) bc.textContent = n ? '(' + n + ')' : '';
  const sells = getTrades().filter((t) => t.exitPrice == null).length;
  const cc = $('calCount'); if (cc) cc.textContent = sells ? '(' + sells + ' sells)' : '';
}
function recRowHTML(r, idx) {
  const st = SIGNAL_STATS[String(r.signal)] || { name: 'Signal #' + r.signal, win: '' };
  return '<div class="rec-row" data-rec="' + r.id + '">' +
    '<div class="rec-line"><b>' + r.ticker + '</b> · #' + r.signal + ' ' + st.name +
    ' · <span class="small">Signal entry price ' + fmt$(r.price) + '</span> · ' + livePriceLine(r.ticker, r.price) +
    ' · sell by ' + (r.sellDate || '—') + ' <span class="small">(' + (r.holdDays != null ? r.holdDays + ' trading days' : 'to close') + ')</span>' +
    ' <button class="secondary rec-expand" data-idx="' + idx + '">Details</button></div>' +
    '<div class="rec-detail" style="display:none">' +
    '<div class="small">' + (r.detail || '') + '</div>' +
    '<div class="small">Signal entry price ' + fmt$(r.price) + ' · Target buy price ' + fmt$(r.price) + ' · Acceptable range ' + targetRange(r.price) + '</div>' +
    '<div class="small">Projection: ' + st.win + '</div>' +
    '<div class="row" style="margin-top:8px">' +
    '<div><label>Your entry price $ (signal price ' + (r.price != null ? fmt$(r.price) : '—') + ')</label><input class="rec-price" type="number" step="0.01" value="' + (r.price != null ? r.price.toFixed(2) : '') + '"></div>' +
    '<div><label>Shares</label><input class="rec-shares" type="number" step="0.01"></div>' +
    '<div><label>…or $ amount</label><input class="rec-amount" type="number" step="0.01"></div>' +
    '<div><button class="rec-log">Log buy</button></div>' +
    '<div><button class="secondary rec-dismiss">Dismiss</button></div>' +
    '</div></div></div>';
}
function wireRecRows(container) {
  container.querySelectorAll('.rec-expand').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('.rec-row');
    const det = row.querySelector('.rec-detail');
    det.style.display = det.style.display === 'none' ? 'block' : 'none';
    b.textContent = det.style.display === 'none' ? 'Details' : 'Hide';
  }));
  container.querySelectorAll('.rec-log').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('.rec-row');
    const id = +row.dataset.rec;
    const price = parseFloat(row.querySelector('.rec-price').value);
    const shares = parseFloat(row.querySelector('.rec-shares').value) || 0;
    const amount = parseFloat(row.querySelector('.rec-amount').value) || 0;
    if (!(price > 0)) { alert('Enter an entry price first.'); return; }
    const rec = store.get('recommendations', []).find((r) => r.id === id);
    if (!rec) return;
    const cost = amount > 0 ? amount : (shares > 0 ? shares * price : 0);
    const trades = getTrades();
    trades.unshift({ id: Date.now(), ticker: rec.ticker, signal: String(rec.signal), entryDate: rec.date,
      entryPrice: price, shares: shares || (cost > 0 ? +(cost / price).toFixed(4) : 0), cost: +cost.toFixed(2),
      sellDate: rec.sellDate || addTradingDays(rec.date, HOLD_DAYS[String(rec.signal)] || 5), exitPrice: null, exitDate: null });
    saveTrades(trades);
    markRecLogged(id);
    renderTrades(); renderBuys(); renderCalendar();
    alert('Logged ' + rec.ticker + ' (signal #' + rec.signal + '). Sell target ' + (rec.sellDate || '') + ' is now on the Calendar.');
  }));
  container.querySelectorAll('.rec-dismiss').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('.rec-row');
    const id = +row.dataset.rec;
    store.set('recommendations', store.get('recommendations', []).filter((r) => r.id !== id));
    renderBuys(); renderCalendar();
  }));
}
function renderBuys() {
  const el = $('buysList'); if (!el) return;
  const recs = getRecs();
  if (!recs.length) { el.innerHTML = '<p class="muted">No recommended buys right now. Run the signals or the EOD scan — new hits appear here, and disappear once their buy window closes (sell-by date) if you do not log them.</p>'; updateCounts(); return; }
  el.innerHTML = recs.map((r, i) => recRowHTML(r, i)).join('');
  wireRecRows(el);
  renderMatching();
  updateCounts();
}

// ---------- Matching sublists (compact ticker / price / pill rows) ----------
function matchRowHTML(r) {
  const color = SIGNAL_COLORS[String(r.signal)] || '#00c805';
  const name = SIGNAL_NAMES[String(r.signal)] || ('Signal #' + r.signal);
  return '<div class="match-row" style="--sig:' + color + '">' +
    '<div class="match-line"><b>' + r.ticker + '</b>' +
    '<span class="pill sigpill" style="background:' + color + '">#' + r.signal + ' ' + name + '</span>' +
    '<span class="small">Signal entry price ' + fmt$(r.price) + '</span> ' + livePriceLine(r.ticker, r.price) + '</div>' +
    '<div class="match-detail" style="display:none">' +
    '<div>Signal date ' + (r.date || '—') + ' · Sell by ' + (r.sellDate || '—') + ' · ' + (r.detail || '') + '</div>' +
    '<div style="margin-top:6px"><button class="secondary match-log">Log trade</button></div>' +
    '</div></div>';
}
function renderMatching() {
  const items = [];
  const seen = new Set();
  const push = (r) => {
    const key = r.ticker + '|' + r.signal;
    if (seen.has(key)) return;
    seen.add(key); items.push(r);
  };
  try { getRecs().forEach((r) => push(r)); } catch (e) {}
  if (lastScan) lastScan.hits.filter((h) => (h.exitDate || lastScan.date) >= todayET()).forEach((h) => push({ ticker: h.ticker, signal: h.signal || 3, date: h.date || lastScan.date, price: h.close, sellDate: h.exitDate, detail: (h.signal === 4 ? 'RSI(2) ' + h.rsi2 + ' < 10.' : h.signal === 5 ? 'Bollinger %B bounce (' + h.prevPctB + ' → ' + h.pctB + ').' : 'Closed ' + (h.pctBelow != null ? h.pctBelow + '%' : '') + ' below its 63-day low.') }));
  for (let sig = 1; sig <= 6; sig++) {
    const el = $('match' + sig);
    if (!el) continue;
    const rows = items.filter((r) => String(r.signal) === String(sig));
    el.innerHTML = rows.length
      ? '<div class="match-title">Matching — ' + rows.length + ' ticker(s)</div>' + rows.map(matchRowHTML).join('')
      : '';
    el.querySelectorAll('.match-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.match-log')) return;
        const det = row.querySelector('.match-detail');
        det.style.display = det.style.display === 'none' ? 'block' : 'none';
      });
      row.querySelector('.match-log').addEventListener('click', () => {
        const b = row.querySelector('b').textContent;
        const rec = items.find((x) => x.ticker === b && String(x.signal) === String(sig));
        if (rec) prefillTrade(rec.ticker, rec.signal, rec.date, rec.price);
      });
    });
  }
}

// ---------- Calendar ----------
const calState = { year: new Date().getFullYear(), month: new Date().getMonth(), view: 'month', selected: null };
function sellsOn(dateISO) { return getTrades().filter((t) => t.sellDate === dateISO && t.exitPrice == null); }
function buysOn(dateISO) { return getTrades().filter((t) => t.entryDate === dateISO); }
function renderCalendar() {
  const grid = $('calGrid'); if (!grid) return;
  const trades = getTrades();
  const title = $('calTitle');
  if (calState.view === 'week') {
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now); monday.setDate(now.getDate() - ((dow + 6) % 7));
    let html = '<table><tr><th>Day</th><th>Sells</th><th>Buys</th></tr>';
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const sells = sellsOn(iso), buys = buysOn(iso);
      html += '<tr><td><b>' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + '</b></td>' +
        '<td>' + sells.length + ' sell' + (sells.length === 1 ? '' : 's') + (sells.length ? ' — ' + sells.map((t) => t.ticker).join(', ') : '') + '</td>' +
        '<td>' + buys.length + ' buy' + (buys.length === 1 ? '' : 's') + (buys.length ? ' — ' + buys.map((t) => t.ticker).join(', ') : '') + '</td></tr>';
    }
    grid.innerHTML = html + '</table>';
    if (title) title.textContent = 'Week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    const y = calState.year, m = calState.month;
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const startDow = (first.getDay() + 6) % 7; // Monday-first
    let html = '<div class="cal-grid"><div class="cal-head">Mon</div><div class="cal-head">Tue</div><div class="cal-head">Wed</div><div class="cal-head">Thu</div><div class="cal-head">Fri</div><div class="cal-head">Sat</div><div class="cal-head">Sun</div>';
    for (let i = 0; i < startDow; i++) html += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const sells = sellsOn(iso), buys = buysOn(iso);
      const isToday = iso === todayET();
      html += '<div class="cal-day' + (isToday ? ' today' : '') + (calState.selected === iso ? ' sel' : '') + '" data-day="' + iso + '">' +
        '<div class="cal-num">' + d + '</div>' +
        (sells.length ? '<div class="cal-pill sell">' + sells.length + ' sell</div>' : '') +
        (buys.length ? '<div class="cal-pill buy">' + buys.length + ' buy</div>' : '') +
        (isToday && getRecs().length ? '<div class="cal-pill rec">' + getRecs().length + ' possible</div>' : '') +
        '</div>';
    }
    grid.innerHTML = html + '</div>';
    if (title) title.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  grid.querySelectorAll('.cal-day[data-day]').forEach((el) => el.addEventListener('click', () => {
    calState.selected = el.dataset.day;
    renderCalendar(); renderCalDetail(el.dataset.day);
  }));
  if (calState.selected) renderCalDetail(calState.selected);
  updateCounts();
}
function renderCalDetail(iso) {
  const el = $('calDetail'); if (!el) return;
  const sells = sellsOn(iso), buys = buysOn(iso);
  const isToday = iso === todayET();
  let html = '<div class="card"><h3>' + iso + (isToday ? ' — today' : '') + '</h3>';
  if (!sells.length && !buys.length && !(isToday && getRecs().length)) html += '<p class="muted">Nothing scheduled this day.</p>';
  for (const t of sells) {
    html += '<div class="kv"><span>SELL · ' + t.ticker + ' (signal #' + t.signal + ') — Entry price ' + fmt$(t.entryPrice) + ' · entered ' + t.entryDate + '</span><span><button class="secondary" data-cal-exit="' + t.id + '">Record exit</button></span></div>';
  }
  for (const t of buys) {
    html += '<div class="kv"><span>BUY · ' + t.ticker + ' (signal #' + t.signal + ') — Entry price ' + fmt$(t.entryPrice) + '</span><span class="small">sell by ' + t.sellDate + '</span></div>';
  }
  if (isToday && getRecs().length) {
    html += '<h3 style="margin-top:12px">Possible buys — log them or they disappear once their buy window closes</h3>';
    html += getRecs().map((r, i) => recRowHTML(r, i)).join('');
  }
  html += '</div>';
  el.innerHTML = html;
  wireRecRows(el);
  el.querySelectorAll('[data-cal-exit]').forEach((b) => b.addEventListener('click', () => {
    const p = prompt('Exit price?');
    if (p && parseFloat(p) > 0) {
      const trades = getTrades();
      const tr = trades.find((x) => x.id === +b.dataset.calExit);
      if (tr) { tr.exitPrice = parseFloat(p); tr.exitDate = todayET(); saveTrades(trades); renderTrades(); renderCalendar(); }
    }
  }));
}
$('calPrevBtn') && $('calPrevBtn').addEventListener('click', () => { calState.month--; if (calState.month < 0) { calState.month = 11; calState.year--; } renderCalendar(); });
$('calNextBtn') && $('calNextBtn').addEventListener('click', () => { calState.month++; if (calState.month > 11) { calState.month = 0; calState.year++; } renderCalendar(); });
$('calWeekBtn') && $('calWeekBtn').addEventListener('click', () => { calState.view = 'week'; renderCalendar(); });
$('calMonthBtn') && $('calMonthBtn').addEventListener('click', () => { calState.view = 'month'; renderCalendar(); });

// ---------- Notifications + sound ----------
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
  } catch (e) {}
}
function notify(title, body) {
  const banner = $('alertBanner');
  banner.textContent = '🔔 ' + title + ' — ' + body;
  banner.classList.add('show');
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) {}
  }
}
function alertOnce(key, title, body) {
  if (alertedKeys.has(key)) return;
  alertedKeys.add(key);
  store.set('alertedKeys', Array.from(alertedKeys));
  notify(title, body);
}
// ---------- Notifications status line (v3) ----------
// The tap always answers with a visible status line under the buttons:
// inside an embedded view the browser can resolve the permission request
// to "blocked" without ever showing a prompt, and the old code silently
// swallowed that outcome so the button looked dead.
function setNotifMsg(msg) {
  const el = $('notifyStatus');
  if (el) el.textContent = msg || '';
}
$('notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    setNotifMsg("This browser doesn't support desktop notifications. The in-app banner and alert sound still fire while this page is open.");
    return;
  }
  setNotifMsg('');
  let p;
  try {
    p = await Notification.requestPermission();
  } catch (e) {
    // Some embedded webviews throw instead of resolving; fall back to the
    // current permission value so the tap still produces an answer.
    p = Notification.permission;
  }
  $('notifyBtn').textContent = p === 'granted' ? 'Notifications on ✓' : 'Enable notifications';
  if (p === 'granted') {
    setNotifMsg("Notifications are on — you'll get a desktop alert when a signal hits.");
    notify('Notifications enabled', 'You will be alerted when a signal hits while the app is open.');
  } else if (p === 'denied') {
    setNotifMsg('Notifications are blocked — no prompt appeared, or permission is off for this site. The in-app banner and alert sound still fire while this page is open. To get desktop alerts, allow notifications for this site in your browser settings.');
  } else {
    setNotifMsg('The permission prompt was dismissed. Tap Enable notifications to try again.');
  }
});
if ('Notification' in window && Notification.permission === 'granted') { $('notifyBtn').textContent = 'Notifications on ✓'; setNotifMsg("Notifications are on — you'll get a desktop alert when a signal hits."); }

// ---------- Status ----------
function setStatus(msg, isErr) {
  $('statusBar').textContent = msg;
  const b = $('dataBadge');
  b.textContent = isErr ? 'Data error' : ('Live · via ' + lastDataSource);
  b.className = 'badge ' + (isErr ? 'err' : 'live');
}
function tickClock() {
  const now = new Date();
  $('clockBadge').textContent = now.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
setInterval(tickClock, 30000); tickClock();

// ---------- Signal #1 + #2 (QQQ / VIX) ----------
async function refreshIndexSignals() {
  try {
    const [qqq, vix] = await Promise.all([fetchYahoo('QQQ', '2y'), fetchYahoo('^VIX', '6mo')]);
    const ma = signalMA(qqq);
    const vx = signalVIX(vix);
    $('qqqPrice').innerHTML = fmt$(ma.close) + ' <span class="small">Latest close · ' + ma.date + ' · RSI-14 ' + (ma.rsi != null ? ma.rsi.toFixed(1) : '—') + '</span>';
    setGauge('gaugeMA', 'gaugeMACap', ma.rsi != null ? ma.rsi / 100 : 0, 'RSI-14 ' + (ma.rsi != null ? ma.rsi.toFixed(1) : '—') + ' (25–30 = full size, 35–45 = skip)');
    setPill('pillMA', ma.hit ? 'BUY SIGNAL — touch' : 'NO SIGNAL — no touch', ma.hit ? 'hit' : 'no');
    const logMA = $('logMA'); if (logMA) { logMA.style.display = ma.hit ? '' : 'none'; logMA.onclick = () => { const b = ma.bands.find((x) => x.touch) || ma.bands[0]; prefillTrade('QQQ', '1', ma.date, ma.close); }; }
    $('vixPrice').innerHTML = vx.close.toFixed(2) + ' <span class="small">Current level · ' + vx.date + ' — not a stock price</span>';
    setGauge('gaugeVIX', 'gaugeVIXCap', vx.close / 50, 'Down streak ' + vx.streak + ' day(s) · peak in prior 10 days ' + vx.peak10.toFixed(2));
    setPill('pillVIX', (vx.hit || vx.capitulation) ? 'BUY SIGNAL' : (vx.armed ? 'ARMED — VIX ≥30' : 'NO SIGNAL'), (vx.hit || vx.capitulation) ? 'hit' : (vx.armed ? 'armed' : 'no'));
    const logVIX = $('logVIX'); if (logVIX) { logVIX.style.display = (vx.hit || vx.capitulation) ? '' : 'none'; logVIX.onclick = () => prefillTrade('QQQ', '2', vx.date, ma.close); }
    let maHtml = '';
    for (const b of ma.bands) {
      maHtml += '<div class="kv"><span>' + b.period + '-day MA ' + fmt$(b.ma) + ' (' + fmtPct(b.distancePct) + ')</span><span>' +
        (b.touch ? '<span class="pill hit">TOUCH — hold ' + b.hold + 'd, exit ' + b.exitDate + '</span>' : 'no touch') + '</span></div>';
    }
    maHtml += '<div class="kv"><span>Sizing</span><span>' + ma.size + '</span></div>';
    maHtml += '<p class="small">Touch = day low within 1% of the MA. ' + (ma.hit ? 'A touch today means buy at the close.' : 'QQQ is below all three bands today — no fresh touch (it is already under them, not touching from above).') + '</p>';
    $('maBody').innerHTML = maHtml;
    $('cardMA').classList.toggle('hit', ma.hit);
    const rsi2 = signalRSI2(qqq);
    const bb = signalBollinger(qqq);
    $('rsi2Price').innerHTML = 'RSI(2) ' + (rsi2.rsi2 != null ? rsi2.rsi2.toFixed(1) : '—') + ' <span class="small">· Latest close ' + fmt$(rsi2.close) + ' · ' + rsi2.date + '</span>';
    setGauge('gaugeRSI2', 'gaugeRSI2Cap', rsi2.rsi2 != null ? rsi2.rsi2 / 100 : 0, 'RSI(2) ' + (rsi2.rsi2 != null ? rsi2.rsi2.toFixed(1) : '—') + ' — buy under 10');
    setPill('pillRSI2', rsi2.hit ? 'BUY SIGNAL — RSI(2) < 10' : 'NO SIGNAL', rsi2.hit ? 'hit' : 'no');
    const logRSI2 = $('logRSI2'); if (logRSI2) { logRSI2.style.display = rsi2.hit ? '' : 'none'; logRSI2.onclick = () => prefillTrade('QQQ', '4', rsi2.date, rsi2.close); }
    $('rsi2Body').innerHTML = '<div class="kv"><span>RSI(2) under 10?</span><span>' + (rsi2.hit ? '<span class="pill hit">HIT — exit when RSI(2) &gt; 50 or by ' + rsi2.exitDate + '</span>' : 'No — RSI(2) ' + (rsi2.rsi2 != null ? rsi2.rsi2.toFixed(1) : '—')) + '</span></div>' +
      '<div class="kv"><span>Latest close</span><span>' + fmt$(rsi2.close) + '</span></div>';
    $('cardRSI2').classList.toggle('hit', rsi2.hit);
    $('bbPrice').innerHTML = '%B ' + (bb.pctB != null ? bb.pctB.toFixed(2) : '—') + ' <span class="small">· Latest close ' + fmt$(bb.close) + ' · ' + bb.date + '</span>';
    setGauge('gaugeBB', 'gaugeBBCap', bb.pctB != null ? Math.max(0, Math.min(1, bb.pctB)) : 0, '%B ' + (bb.pctB != null ? bb.pctB.toFixed(2) : '—') + ' (yesterday ' + (bb.prevPctB != null ? bb.prevPctB.toFixed(2) : '—') + ')');
    setPill('pillBB', bb.hit ? 'BUY SIGNAL — bounce' : 'NO SIGNAL', bb.hit ? 'hit' : 'no');
    const logBB = $('logBB'); if (logBB) { logBB.style.display = bb.hit ? '' : 'none'; logBB.onclick = () => prefillTrade('QQQ', '5', bb.date, bb.close); }
    $('bbBody').innerHTML = '<div class="kv"><span>Lower band price / Upper band price</span><span>' + (bb.lower != null ? fmt$(bb.lower) + ' / ' + fmt$(bb.upper) : '—') + '</span></div>' +
      '<div class="kv"><span>%B yesterday → today</span><span>' + (bb.prevPctB != null ? bb.prevPctB.toFixed(2) + ' → ' + bb.pctB.toFixed(2) : '—') + '</span></div>' +
      '<div class="kv"><span>Bounce (below band, then back inside)</span><span>' + (bb.hit ? '<span class="pill hit">HIT — hold 5d, exit ' + bb.exitDate + '</span>' : 'Not hit') + '</span></div>';
    $('cardBB').classList.toggle('hit', bb.hit);
    if (rsi2.hit) {
      alertOnce('rsi2:QQQ:' + rsi2.date, 'Signal #4 — RSI(2) under 10 on QQQ', 'RSI(2) ' + rsi2.rsi2.toFixed(1) + '. Exit when RSI(2) > 50 or by ' + rsi2.exitDate + '.');
      addRec({ ticker: 'QQQ', signal: 4, date: rsi2.date, price: rsi2.close, sellDate: rsi2.exitDate, holdDays: 5, detail: 'RSI(2) ' + rsi2.rsi2.toFixed(1) + ' < 10 at the close.' });
    }
    if (bb.hit) {
      alertOnce('bb:QQQ:' + bb.date, 'Signal #5 — Bollinger %B bounce on QQQ', '%B ' + bb.prevPctB.toFixed(2) + ' → ' + bb.pctB.toFixed(2) + '. Hold 5 trading days, exit ' + bb.exitDate + '.');
      addRec({ ticker: 'QQQ', signal: 5, date: bb.date, price: bb.close, sellDate: bb.exitDate, holdDays: 5, detail: 'Closed below the lower Bollinger Band, then back inside (%B ' + bb.prevPctB.toFixed(2) + ' → ' + bb.pctB.toFixed(2) + ').' });
    }
    let vxHtml = '<div class="kv"><span>Armed (VIX ≥30)</span><span>' + (vx.armed ? '<span class="pill armed">ARMED</span>' : 'No — VIX ' + vx.close.toFixed(2)) + '</span></div>' +
      '<div class="kv"><span>Down streak</span><span>' + vx.streak + ' day(s)</span></div>' +
      '<div class="kv"><span>Peak in prior 10 days</span><span>' + vx.peak10.toFixed(2) + '</span></div>' +
      '<div class="kv"><span>3-down-day rule</span><span>' + (vx.hit ? '<span class="pill hit">HIT — hold 20d, exit ' + vx.exitDate + '</span>' : 'Not hit — needs 3 straight down days while VIX ≥25') + '</span></div>' +
      '<div class="kv"><span>Capitulation (≥40 peak, 2nd down day)</span><span>' + (vx.capitulation ? '<span class="pill hit">HIT — hold 20d, exit ' + vx.exitDate + '</span>' : 'Not hit') + '</span></div>';
    $('vixBody').innerHTML = vxHtml;
    $('cardVIX').classList.toggle('hit', vx.hit || vx.capitulation);
    if (ma.hit) {
      alertOnce('ma:' + ma.date, 'Signal #1 — MA-band touch on QQQ', 'QQQ touched a 290/330/420-day band. RSI ' + (ma.rsi || 0).toFixed(1) + '. ' + ma.size + '.');
      const band = ma.bands.find((b) => b.touch) || ma.bands[0];
      addRec({ ticker: 'QQQ', signal: 1, date: ma.date, price: ma.close, sellDate: band.exitDate, holdDays: band.hold, detail: 'Touched the ' + band.period + '-day MA. RSI ' + (ma.rsi || 0).toFixed(1) + ' — ' + ma.size + '.' });
    }
    if (vx.hit) {
      alertOnce('vix:' + vx.date, 'Signal #2 — VIX 3-down-day', 'VIX ' + vx.close.toFixed(2) + ', 3rd straight down day. Hold 20 trading days, exit ' + vx.exitDate + '.');
      addRec({ ticker: 'QQQ', signal: 2, date: vx.date, price: ma.close, sellDate: vx.exitDate, holdDays: 20, detail: 'VIX ' + vx.close.toFixed(2) + ', 3rd straight down day while VIX ≥25.' });
    }
    if (vx.capitulation) alertOnce('vixcap:' + vx.date, 'Signal #2 — VIX capitulation', 'VIX peaked ≥40 in the prior 10 days, 2nd down day. Hold 20 trading days.');
    renderMatching();
    return { ma, vx };
  } catch (e) {
    $('maBody').innerHTML = '<p class="down">Could not load QQQ/VIX: ' + e.message + '</p>';
    $('vixBody').innerHTML = '<p class="down">Could not load VIX: ' + e.message + '</p>';
    throw e;
  }
}

// ---------- Signal #3 ticker lookup ----------
async function checkTicker(symbol) {
  symbol = (symbol || '').trim().toUpperCase();
  if (!symbol) return;
  const body = $('tickerBody');
  body.innerHTML = '<p class="muted">Loading ' + symbol + '…</p>';
  try {
    const rows = await fetchYahoo(symbol, '1y');
    const s = signalDip(rows);
    const r2 = signalRSI2(rows);
    const bb = signalBollinger(rows);
    const pill = s.status === 'HIT' ? '<span class="pill hit">HIT</span>' : (s.status === 'CLOSE' ? '<span class="pill close">CLOSE</span>' : '<span class="pill no">NO SIGNAL</span>');
    body.innerHTML =
      '<div class="kv"><span>' + symbol + ' · ' + s.date + '</span><span>' + pill + '</span></div>' +
      '<div class="kv"><span>Latest close</span><span>' + fmt$(s.close) + '</span></div>' +
      '<div class="kv"><span>3-month low close (lowest close, prior 63 trading days)</span><span>' + fmt$(s.low63) + '</span></div>' +
      '<div class="kv"><span>% below that low</span><span class="' + (s.pctBelow < 0 ? 'down' : 'up') + '">' + fmtPct(s.pctBelow) + '</span></div>' +
      '<div class="kv"><span>Today\'s return</span><span>' + fmtPct(s.dayRet) + '</span></div>' +
      '<div class="kv"><span>Sharp flush (≥2% below low in one day)</span><span>' + (s.sharp ? 'Yes' : 'No') + '</span></div>' +
      '<div class="kv"><span>RSI (Wilder 14)</span><span>' + (s.rsi != null ? s.rsi.toFixed(1) : '—') + '</span></div>' +
      '<div class="kv"><span>Signal #4 — RSI(2)</span><span>' + (r2.rsi2 != null ? r2.rsi2.toFixed(1) : '—') + (r2.hit ? ' — <span class="pill hit">HIT</span> exit when RSI(2) &gt; 50 or by ' + r2.exitDate : ' — no hit (needs &lt; 10)') + '</span></div>' +
      '<div class="kv"><span>Signal #5 — Bollinger %B</span><span>' + (bb.pctB != null ? bb.pctB.toFixed(2) + ' (prev ' + bb.prevPctB.toFixed(2) + ')' : '—') + (bb.hit ? ' — <span class="pill hit">HIT</span> hold 5d, exit ' + bb.exitDate : ' — no bounce') + '</span></div>' +
      (s.hit ? '<p><b>Signal #3 HIT.</b> Buy at the close, hold 5 trading days, exit ' + s.exitDate + '. <button class="secondary" id="logThisBtn">Log this trade</button></p>'
             : '<p class="small">Trigger price is a close at or below ' + fmt$(s.low63 * 0.95) + ' (5% below the 63-day low). Distance to trigger price: ' + fmtPct((s.close / (s.low63 * 0.95) - 1) * 100) + '.</p>');
    $('cardDip').classList.toggle('hit', s.hit);
    $('cardDip').classList.toggle('close-call', !s.hit && s.status === 'CLOSE');
    lastDipTicker = symbol;
    $('dipPrice').innerHTML = fmt$(s.close) + ' <span class="small">Latest close · ' + s.date + '</span>';
    setGauge('gaugeDip', 'gaugeDipCap', Math.abs(s.pctBelow) / 20, fmtPct(s.pctBelow) + ' below the 63-day low close ' + fmt$(s.low63));
    setPill('pillDip', s.status === 'HIT' ? 'BUY SIGNAL — dip' : (s.status === 'CLOSE' ? 'CLOSE — near trigger' : 'NO SIGNAL'), s.status === 'HIT' ? 'hit' : (s.status === 'CLOSE' ? 'close' : 'no'));
    updateCurrentPriceLines();
    refreshLivePrices([symbol]);
    if (s.hit) {
      addRec({ ticker: symbol, signal: 3, date: s.date, price: s.close, sellDate: s.exitDate, holdDays: 5, detail: 'Closed ' + s.pctBelow.toFixed(1) + '% below its 63-day low.' + (s.sharp ? ' Sharp flush.' : '') });
      alertOnce('dip:' + symbol + ':' + s.date, 'Signal #3 — dip buy on ' + symbol, symbol + ' closed ' + s.pctBelow.toFixed(1) + '% below its 63-day low at ' + fmt$(s.close) + '. Hold 5 trading days, exit ' + s.exitDate + '.');
      const lb = $('logThisBtn');
      if (lb) lb.addEventListener('click', () => {
        $('logTicker').value = symbol; $('logSignal').value = '3';
        $('logDate').value = s.date; $('logPrice').value = s.close.toFixed(2);
        document.querySelector('#logTradeBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    if (r2.hit) addRec({ ticker: symbol, signal: 4, date: r2.date, price: r2.close, sellDate: r2.exitDate, holdDays: 5, detail: 'RSI(2) ' + r2.rsi2.toFixed(1) + ' < 10 at the close.' });
    if (bb.hit) addRec({ ticker: symbol, signal: 5, date: bb.date, price: bb.close, sellDate: bb.exitDate, holdDays: 5, detail: 'Bollinger %B bounce (' + bb.prevPctB.toFixed(2) + ' → ' + bb.pctB.toFixed(2) + ').' });
    renderBuys();
    return s;
  } catch (e) {
    body.innerHTML = '<p class="down">Could not load ' + symbol + ': ' + e.message + '</p>';
    return null;
  }
}
// ---------- Signal #6 — opening range breakout ----------
async function checkOrb(symbol) {
  symbol = (symbol || '').trim().toUpperCase();
  const body = $('orbBody'); if (!symbol) return;
  body.innerHTML = '<p class="muted">Loading intraday bars for ' + symbol + '…</p>';
  try {
    const bars = await fetchIntraday(symbol);
    const o = signalORB(bars);
    body.innerHTML = '<div class="kv"><span>' + symbol + ' · ' + o.date + '</span><span>' + (o.hit ? '<span class="pill hit">BREAKOUT</span>' : '<span class="pill no">NO BREAKOUT</span>') + '</span></div>' +
      '<div class="kv"><span>Opening-range low / Opening-range high (9:30–9:45am ET)</span><span>' + fmt$(o.orLow) + ' – ' + fmt$(o.orHigh) + '</span></div>' +
      '<div class="kv"><span>Last 15-min close</span><span>' + fmt$(o.lastClose) + '</span></div>' +
      (o.hit ? '<div class="kv"><span>Breakout price</span><span>' + fmt$(o.breakoutPrice) + ' at ' + o.breakoutTime + '</span></div>' : '') +
      '<p class="small">' + o.status + ' Hold to the close today — this is an intraday signal, it does not carry a multi-day clock exit.</p>' +
      (o.hit ? '<p><button class="secondary" id="logOrbBtn">Log this ORB trade</button></p>' : '');
    $('cardORB').classList.toggle('hit', o.hit);
    lastOrbTicker = symbol;
    $('orbPrice').innerHTML = fmt$(o.lastClose) + ' <span class="small">Last 15-min close · ' + o.date + '</span>';
    const orSpan = (o.orHigh != null && o.orLow != null && o.orHigh > o.orLow) ? (o.lastClose - o.orLow) / (o.orHigh - o.orLow) : 0;
    setGauge('gaugeORB', 'gaugeORBCap', orSpan, 'Last close ' + fmt$(o.lastClose) + ' vs opening-range high ' + fmt$(o.orHigh));
    setPill('pillORB', o.hit ? 'BUY SIGNAL — breakout' : 'NO BREAKOUT', o.hit ? 'hit' : 'no');
    updateCurrentPriceLines();
    refreshLivePrices([symbol]);
    if (o.hit) {
      alertOnce('orb:' + symbol + ':' + o.date, 'Signal #6 — opening range breakout on ' + symbol, symbol + ' broke above ' + fmt$(o.orHigh) + ' at ' + o.breakoutTime + '. Hold to the close.');
      addRec({ ticker: symbol, signal: 6, date: o.date, price: o.breakoutPrice, sellDate: o.date, holdDays: 0, detail: '15-min close above opening-range high ' + fmt$(o.orHigh) + ' at ' + o.breakoutTime + '. Hold to the close.' });
      const lb = $('logOrbBtn');
      if (lb) lb.addEventListener('click', () => {
        $('logTicker').value = symbol; $('logSignal').value = '6';
        $('logDate').value = o.date; $('logPrice').value = o.breakoutPrice.toFixed(2);
        showTab('trades');
      });
    }
    return o;
  } catch (e) {
    body.innerHTML = '<p class="down">Could not load intraday data for ' + symbol + ': ' + e.message + '</p>';
    return null;
  }
}
$('checkOrbBtn').addEventListener('click', () => checkOrb($('orbTicker').value));
$('orbTicker').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkOrb($('orbTicker').value); });
$('checkTickerBtn').addEventListener('click', () => checkTicker($('tickerInput').value));
$('tickerInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkTicker($('tickerInput').value); });

// ---------- Watchlist ----------
async function loadWatchlist() {
  if (watchlist) return watchlist;
  try {
    const res = await fetch('watchlist.json');
    const data = await res.json();
    watchlist = data.tickers.map((t) => t.ticker);
    store.set('watchlistMeta', data.tickers);
    return watchlist;
  } catch (e) {
    watchlist = ['QQQ', 'SPY', 'NVDA', 'XLK'];
    return watchlist;
  }
}
function renderWatchlist() {
  const meta = store.get('watchlistMeta', []);
  const byTicker = {}; meta.forEach((m) => { byTicker[m.ticker] = m; });
  $('watchlistList').textContent = watchlist.map((t) => {
    const m = byTicker[t];
    return t + (m && m.leveraged_or_inverse ? ' ⚠ lev/inv' : '') + (m ? ' ($' + Number(m.value).toLocaleString() + ')' : '');
  }).join('  ·  ');
}
$('addTickerBtn').addEventListener('click', async () => {
  const t = $('addTickerInput').value.trim().toUpperCase();
  if (!t) return;
  await loadWatchlist();
  if (!watchlist.includes(t)) { watchlist.push(t); store.set('watchlist', watchlist); }
  $('addTickerInput').value = '';
  renderWatchlist();
});

// ---------- EOD scan (signal #3 over the watchlist) ----------
async function runEodScan() {
  pruneExpired(); // a scan also clears alerts whose buy window has closed
  const list = await loadWatchlist();
  const btn = $('scanBtn'); btn.disabled = true;
  $('scanStatus').textContent = 'Scanning 0 / ' + list.length + '…';
  const hits = [], errors = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    $('scanStatus').textContent = 'Scanning ' + (i + 1) + ' / ' + list.length + ' — ' + t;
    try {
      const rows = await fetchYahoo(t, '1y');
      const s = signalDip(rows);
      const r2 = signalRSI2(rows);
      const bb = signalBollinger(rows);
      const meta = (store.get('watchlistMeta', []) || []).find((m) => m.ticker === t);
      if (s.hit) hits.push({ signal: 3, ticker: t, date: s.date, close: s.close, low63: s.low63, pctBelow: +s.pctBelow.toFixed(2), dayRet: +s.dayRet.toFixed(2), sharp: s.sharp, rsi: s.rsi != null ? +s.rsi.toFixed(1) : null, exitDate: s.exitDate, leveraged_or_inverse: !!(meta && meta.leveraged_or_inverse) });
      if (r2.hit) hits.push({ signal: 4, ticker: t, date: r2.date, close: r2.close, rsi2: +r2.rsi2.toFixed(1), exitDate: r2.exitDate, leveraged_or_inverse: !!(meta && meta.leveraged_or_inverse) });
      if (bb.hit) hits.push({ signal: 5, ticker: t, date: bb.date, close: bb.close, pctB: +bb.pctB.toFixed(2), prevPctB: +bb.prevPctB.toFixed(2), exitDate: bb.exitDate, leveraged_or_inverse: !!(meta && meta.leveraged_or_inverse) });
    } catch (e) { errors.push(t + ': ' + e.message); }
    await new Promise((r) => setTimeout(r, 120)); // be polite to Yahoo / proxies
  }
  btn.disabled = false;
  const scan = { date: todayISO(), time: new Date().toLocaleTimeString(), scanned: list.length, hits, errors };
  const history = store.get('scanHistory', []);
  history.unshift(scan); store.set('scanHistory', history.slice(0, 30));
  renderScan(scan); renderScanHistory();
  $('scanStatus').textContent = 'Done: ' + hits.length + ' hit(s) out of ' + list.length + ' scanned. ' + (errors.length ? errors.length + ' fetch error(s).' : '');
  for (const h of hits) {
    addRec({ ticker: h.ticker, signal: h.signal || 3, date: h.date, price: h.close, sellDate: h.exitDate, holdDays: HOLD_DAYS[String(h.signal || 3)] || 5,
      detail: (h.signal === 4 ? 'RSI(2) ' + h.rsi2 + ' < 10.' : h.signal === 5 ? 'Bollinger %B bounce (' + h.prevPctB + ' → ' + h.pctB + ').' : 'Closed ' + h.pctBelow + '% below its 63-day low.' + (h.sharp ? ' Sharp flush.' : '')) });
  }
  renderBuys(); renderCalendar();
  if (hits.length) {
    const key = 'eod:' + scan.date;
    alertOnce(key, 'EOD scan — ' + hits.length + ' hit(s)', hits.slice(0, 5).map((h) => '#' + (h.signal || 3) + ' ' + h.ticker).join(', ') + (hits.length > 5 ? '…' : ''));
  }
  return scan;
}
function renderScan(scan) {
  // Expired hits are removed once their buy window passes (sell-by date);
  // the summary count matches what is actually listed.
  if (scan && scan.hits) scan.hits = scan.hits.filter((h) => (h.exitDate || scan.date) >= todayET());
  lastScan = scan;
  const sum = $('scanSummary'), res = $('scanResults'), btn = $('scanToggleBtn');
  if (!scan || !scan.hits) { if (sum) sum.textContent = 'No scan run yet this session.'; return; }
  const counts = {};
  scan.hits.forEach((h) => { counts[h.signal || 3] = (counts[h.signal || 3] || 0) + 1; });
  const breakdown = Object.keys(counts).sort().map((k) => counts[k] + ' #' + k + ' ' + (SIGNAL_NAMES[k] || '')).join(' · ');
  if (sum) sum.textContent = scan.hits.length + ' hit(s) · ' + scan.scanned + ' scanned · ' + scan.date + (breakdown ? ' — ' + breakdown : '');
  if (btn) {
    btn.style.display = scan.hits.length ? '' : 'none';
    btn.textContent = scanOpen ? 'Hide hits' : 'Show hits';
    btn.onclick = () => { scanOpen = !scanOpen; btn.textContent = scanOpen ? 'Hide hits' : 'Show hits'; if (res) res.style.display = scanOpen ? '' : 'none'; };
  }
  if (res) {
    res.style.display = scanOpen ? '' : 'none';
    if (!scan.hits.length) { res.innerHTML = '<p>No hits in this scan (' + scan.date + ').</p>'; return; }
    res.innerHTML = scan.hits.map((h) => matchRowHTML({
      ticker: h.ticker, signal: h.signal || 3, date: h.date || scan.date, price: h.close, sellDate: h.exitDate,
      detail: (h.signal === 4 ? 'RSI(2) ' + h.rsi2 + ' < 10.' : h.signal === 5 ? 'Bollinger %B bounce (' + h.prevPctB + ' → ' + h.pctB + ').' : 'Closed ' + (h.pctBelow != null ? h.pctBelow + '%' : '') + ' below its 63-day low.' + (h.sharp ? ' Sharp flush.' : '')) + ' Sell by ' + (h.exitDate || '—') + '.'
    })).join('');
    res.querySelectorAll('.match-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.match-log')) return;
        const det = row.querySelector('.match-detail');
        det.style.display = det.style.display === 'none' ? 'block' : 'none';
      });
      row.querySelector('.match-log').addEventListener('click', () => {
        const b = row.querySelector('b').textContent;
        const hit = scan.hits.find((x) => x.ticker === b);
        if (hit) prefillTrade(hit.ticker, hit.signal || 3, hit.date || scan.date, hit.close);
      });
    });
  }
  renderMatching();
}
function renderScanHistory() {
  pruneExpired(); // drops expired hits from saved scans, keeps counts in sync
  const history = store.get('scanHistory', []);
  $('scanHistory').innerHTML = history.length
    ? history.map((s) => '<div>' + s.date + ' ' + (s.time || '') + ' — ' + s.hits.length + ' hit(s): ' + (s.hits.map((h) => h.ticker).join(', ') || 'none') + '</div>').join('')
    : 'No scans saved in this browser yet.';
}
$('scanBtn').addEventListener('click', runEodScan);
$('loadGhScanBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('docs/scan-results.json');
    if (!res.ok) throw new Error('No GitHub Actions scan file yet (docs/scan-results.json, HTTP ' + res.status + ')');
    const scan = await res.json();
    renderScan(scan);
    for (const h of scan.hits || []) addRec({ ticker: h.ticker, signal: h.signal || 3, date: h.date || scan.date, price: h.close, sellDate: h.exitDate, holdDays: HOLD_DAYS[String(h.signal || 3)] || 5, detail: 'From the GitHub Actions EOD scan.' });
    renderBuys(); renderCalendar();
    $('scanStatus').textContent = 'Loaded GitHub Actions scan from ' + scan.date + ': ' + scan.hits.length + ' hit(s).';
  } catch (e) { $('scanStatus').textContent = e.message; }
});

// ---------- Trade log ----------
const HOLD_DAYS = { '1': 10, '2': 20, '3': 5, '4': 5, '5': 5, '6': 0 };
const SIGNAL_STATS = {
  '1': { name: 'MA-band + RSI', win: '93.8% win · +3.92% avg (filtered QQQ, n=16)' },
  '2': { name: 'VIX 3-down-day', win: '70% win · +3.76% at 20d (n=57); capitulation 81% · +4.79% (n=42)' },
  '3': { name: 'Dip buy', win: '65.8% win · +4.6% avg (n=260, past year)' },
  '4': { name: 'RSI(2)', win: '~70–80% win on index ETFs (literature — not yet backtested on this universe)' },
  '5': { name: 'Bollinger %B', win: 'Low-60s% win at 5d (literature — not yet backtested on this universe)' },
  '6': { name: 'ORB 15-min', win: '~45–55% win, winners bigger than losers (literature; intraday only)' },
};
const HELP_TEXT = {
  ma: 'Signal #1: buy QQQ at the close when its day low gets within 1% of the 290- or 330-day moving average, hold 10 trading days (420-day: 20 days). RSI 25–30 = full size, 35–45 = skip (dead zone). Filtered backtest: 16 trades, 93.8% win, +3.92% mean.',
  vix: 'Signal #2: arm when VIX closes at or above 30. Buy at the close of the 3rd straight VIX down day while VIX is still at or above 25, hold 20 trading days. Capitulation: VIX peaked at or above 40 in the prior 10 days, then a 2nd down day (81% win, +4.79% at 20d).',
  dip: 'Signal #3: buy when a stock closes 5% below its lowest close in the prior 63 trading days, hold 5 trading days. A sharp flush (close 2%+ below the low in one day) bounces better than a slow drift. Backtest: 65.8% win, n=260, +4.6% mean.',
  rsi2: 'Signal #4: buy when the 2-day RSI (Wilder) drops under 10 at the close. Exit when RSI(2) crosses back over 50, or after 5 trading days — whichever comes first. Literature puts it at ~70–80% win on index ETFs; it has not yet been backtested on this universe.',
  bb: 'Signal #5: Bollinger Bands, 20-day, 2 standard deviations. Buy when the close was below the lower band yesterday (%B under 0) and closes back inside the band today (%B 0–1). Hold 5 days. Literature: low-60s% win at 5 days; not yet backtested on this universe.',
  orb: 'Signal #6: opening range breakout. Take the first 15-minute bar (9:30–9:45am ET) high as the opening range. Buy on a 15-min close above that high, hold to the close the same day. Intraday only — it only fires during market hours. Literature: ~45–55% win, winners bigger than losers.',
  how: 'All six signals are clock exits — sell on the target date, no stop-loss. Stops made every backtest worse for signals #1–#3. Win rates are backtests, not guarantees, and this app places no trades.',
};
function todayET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
}
function getTrades() { return store.get('trades', []); }
function saveTrades(t) { store.set('trades', t); }
$('logDate').value = todayISO();
$('logTradeBtn').addEventListener('click', () => {
  const ticker = $('logTicker').value.trim().toUpperCase();
  const signal = $('logSignal').value;
  const date = $('logDate').value;
  const price = parseFloat($('logPrice').value);
  const shares = parseFloat($('logShares').value) || 0;
  const amount = parseFloat($('logAmount').value) || 0;
  if (!ticker || !date || !(price > 0)) { alert('Enter ticker, entry date, and entry price.'); return; }
  const cost = amount > 0 ? amount : (shares > 0 ? shares * price : 0);
  const trades = getTrades();
  trades.unshift({ id: Date.now(), ticker, signal, entryDate: date, entryPrice: price,
    shares: shares || (cost > 0 ? +(cost / price).toFixed(4) : 0), cost: +cost.toFixed(2),
    sellDate: addTradingDays(date, HOLD_DAYS[signal]), exitPrice: null, exitDate: null });
  saveTrades(trades);
  $('logPrice').value = ''; $('logShares').value = ''; $('logAmount').value = '';
  renderTrades(); renderCalendar();
});
async function renderTrades() {
  const trades = getTrades();
  const el = $('tradeList');
  if (!trades.length) { el.innerHTML = '<p class="muted">No trades logged yet.</p>'; return; }
  // Refresh live prices for open trades (best effort, one at a time)
  for (const t of trades) {
    if (t.exitPrice == null && t.livePrice == null) {
      try { const rows = await fetchYahoo(t.ticker, '5d'); t.livePrice = rows[rows.length - 1].adj; t.liveDate = rows[rows.length - 1].date; } catch (e) { /* leave blank, show error in status */ }
    }
  }
  saveTrades(trades);
  let html = '<table><tr><th>Ticker / Signal</th><th>Entry price</th><th>Amount invested</th><th>Sell target</th><th>Live price / Exit price</th><th>Outcome</th><th></th></tr>';
  for (const t of trades) {
    const daysLeft = t.exitPrice == null ? tradingDaysBetween(todayISO(), t.sellDate) : null;
    const countdown = t.exitPrice == null ? (todayISO() > t.sellDate ? 'SELL DATE PASSED' : daysLeft + ' trading day(s) left') : '';
    let outcome = '—';
    if (t.exitPrice != null) {
      const ret = (t.exitPrice / t.entryPrice - 1) * 100;
      outcome = '<span class="' + (ret >= 0 ? 'up' : 'down') + '">' + fmtPct(ret) + '</span>';
    } else if (t.livePrice != null) {
      outcome = '<span class="small">unrealised ' + fmtPct((t.livePrice / t.entryPrice - 1) * 100) + '</span>';
    }
    html += '<tr><td><b>' + t.ticker + '</b> · signal #' + t.signal + '</td>' +
      '<td>Entry price ' + fmt$(t.entryPrice) + '<br><span class="small">' + t.entryDate + '</span></td>' +
      '<td>' + (t.cost ? fmt$(t.cost) : '—') + '<br><span class="small">' + (t.shares ? t.shares + ' sh' : '') + '</span></td>' +
      '<td>' + t.sellDate + '<br><span class="small">' + countdown + '</span></td>' +
      '<td>' + (t.exitPrice != null ? 'Exit price ' + fmt$(t.exitPrice) + ' · ' + t.exitDate : (t.livePrice != null ? 'Live price ' + fmt$(t.livePrice) + ' · Latest close ' + t.liveDate : '—')) + '</td>' +
      '<td>' + outcome + '</td>' +
      '<td>' + (t.exitPrice == null ? '<button class="secondary" data-exit="' + t.id + '">Record exit</button> ' : '') + '<button class="secondary" data-del="' + t.id + '">Delete</button></td></tr>';
  }
  el.innerHTML = html + '</table>';
  renderCalendar();
  el.querySelectorAll('[data-exit]').forEach((b) => b.addEventListener('click', () => {
    const p = prompt('Exit price for this trade? (leave blank to use the sell-date reference close — fetch it when the date arrives)');
    const trades2 = getTrades();
    const tr = trades2.find((x) => x.id === +b.dataset.exit);
    if (!tr) return;
    if (p && parseFloat(p) > 0) { tr.exitPrice = parseFloat(p); tr.exitDate = todayISO(); }
    else { tr.exitPrice = null; tr.exitDate = null; alert('No exit recorded. Enter the exit price once you sell, or use the reference close on ' + tr.sellDate + '.'); return; }
    saveTrades(trades2); renderTrades();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this trade from the log?')) return;
    saveTrades(getTrades().filter((x) => x.id !== +b.dataset.del)); renderTrades();
  }));
}
$('exportTradesBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(getTrades(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'buy-signal-trades.json'; a.click();
});
$('importTradesBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { const t = JSON.parse(r.result); if (!Array.isArray(t)) throw new Error('Not a trade list'); saveTrades(t); renderTrades(); } catch (err) { alert('Import failed: ' + err.message); } };
  r.readAsText(f);
});

// ---------- Refresh all + auto EOD ----------
async function refreshAll() {
  pruneExpired(); // Refresh also clears alerts whose buy window has closed
  setStatus('Pulling live data from Yahoo Finance…');
  try {
    await refreshIndexSignals();
    await checkTicker($('tickerInput').value || 'NVDA');
    try {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const mins = nowET.getHours() * 60 + nowET.getMinutes();
      if (mins >= 570 && mins <= 960 && nowET.getDay() >= 1 && nowET.getDay() <= 5) await checkOrb($('orbTicker').value || 'QQQ');
    } catch (e) { /* ORB is best-effort intraday; daily signals are the priority */ }
    await refreshLivePrices(allLiveTickers());
    renderBuys(); renderCalendar(); renderMatching();
    setStatus('Last updated ' + new Date().toLocaleTimeString() + ' · Current prices updated ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) + ' ET · via ' + lastDataSource + ' · Yahoo Finance.');
  } catch (e) {
    setStatus('Data error: ' + e.message, true);
  }
}
$('refreshBtn').addEventListener('click', refreshAll);
async function init() {
  pruneExpired(); // dashboard open clears alerts whose buy window has closed
  renderWatchlist(); renderScanHistory(); renderTrades(); renderBuys(); renderCalendar();
  await loadWatchlist(); renderWatchlist();
  await refreshAll();
  // Auto EOD scan: if opened after 4:15pm ET and no scan saved today, run it.
  try {
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const history = store.get('scanHistory', []);
    const scannedToday = history.some((s) => s.date === todayISO());
    if (!scannedToday && (nowET.getHours() > 16 || (nowET.getHours() === 16 && nowET.getMinutes() >= 15))) {
      runEodScan();
    }
  } catch (e) {}
  // Intraday refresh every 15 minutes while open.
  setInterval(() => {
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const mins = nowET.getHours() * 60 + nowET.getMinutes();
    if (mins >= 570 && mins <= 960 && nowET.getDay() >= 1 && nowET.getDay() <= 5) refreshAll();
  }, 15 * 60 * 1000);
  // Current-price refresh every 60 seconds while open (lightweight quotes only).
  setInterval(() => { refreshLivePrices(allLiveTickers()); }, 60 * 1000);
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
init();
