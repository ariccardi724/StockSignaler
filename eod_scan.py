#!/usr/bin/env python3
"""End-of-day scan for the Buy Signal Alert Engine — Generic (GitHub Actions).

Fetches Yahoo Finance daily closes for every ticker in watchlist.json
(generic universe: indexes, Mag 7, sector/industry ETFs), computes
signals #3 (dip: close <= 5% below the lowest close in the prior
63 trading days), #4 (RSI(2) < 10), and #5 (Bollinger %B bounce:
close below the lower band, then back inside), and writes
docs/scan-results.json, which the app loads with the "Load latest
GitHub Actions scan" button.

No fake data: a ticker that fails to fetch is listed in "errors" and
does not produce a hit. Run:  python3 scripts/eod_scan.py
"""
import json, math, os, sys, urllib.request, urllib.parse, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def fetch_chart(symbol, rng="1y"):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           + urllib.parse.quote(symbol) + "?range=" + rng + "&interval=1d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    result = data["chart"]["result"][0]
    ts = result["timestamp"]
    adj = result["indicators"]["adjclose"][0]["adjclose"]
    closes = [c for c in adj if c is not None]
    return closes

HOLIDAYS_2026_2027 = {
    "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19",
    "2026-07-03","2026-09-07","2026-11-26","2026-12-25",
    "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18",
    "2027-07-05","2027-09-06","2027-11-25","2027-12-24",
}
def add_trading_days(date_iso, n):
    d = datetime.date.fromisoformat(date_iso)
    left = n
    while left > 0:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS_2026_2027:
            left -= 1
    return d.isoformat()

def bollinger_pctb(closes, period=20, mult=2.0):
    """%B for the last two closes; None if not enough data."""
    if len(closes) < period + 1:
        return None, None
    out = []
    for end in (len(closes) - 1, len(closes)):
        w = closes[end - period:end]
        mean = sum(w) / period
        sd = math.sqrt(sum((x - mean) ** 2 for x in w) / period)
        out.append((closes[end - 1] - (mean - mult * sd)) / (2 * mult * sd) if sd else 0.5)
    return out[0], out[1]  # yesterday, today

def rsi_wilder(closes, period=14):
    if len(closes) <= period:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0.0)); losses.append(max(-ch, 0.0))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)

def signal_rsi2(closes):
    return rsi_wilder(closes, period=2)

def signal_dip(closes):
    prior = closes[-64:-1]  # 63 trading days before the last day
    low63 = min(prior)
    last = closes[-1]
    pct_below = (last / low63 - 1) * 100
    day_ret = (last / closes[-2] - 1) * 100
    sharp = last < low63 and (low63 - last) / low63 >= 0.02
    return low63, pct_below, day_ret, sharp, rsi_wilder(closes)

def main():
    with open(os.path.join(ROOT, "watchlist.json")) as f:
        watch = json.load(f)
    tickers = watch["tickers"]
    hits, errors = [], []
    for entry in tickers:
        t = entry["ticker"]
        try:
            closes = fetch_chart(t)
            if len(closes) < 70:
                raise ValueError("too few bars: %d" % len(closes))
            today = datetime.date.today().isoformat()
            low63, pct, day_ret, sharp, rsi = signal_dip(closes)
            rsi2 = signal_rsi2(closes)
            prev_b, cur_b = bollinger_pctb(closes)
            if closes[-1] <= low63 * 0.95:
                hits.append({
                    "signal": 3, "ticker": t, "date": today,
                    "close": round(closes[-1], 2),
                    "low63": round(low63, 2),
                    "pctBelow": round(pct, 2),
                    "dayRet": round(day_ret, 2),
                    "sharp": bool(sharp),
                    "rsi": round(rsi, 1) if rsi is not None else None,
                    "exitDate": add_trading_days(today, 5),
                    "leveraged_or_inverse": bool(entry.get("leveraged_or_inverse")),
                })
            if rsi2 is not None and rsi2 < 10:
                hits.append({
                    "signal": 4, "ticker": t, "date": today,
                    "close": round(closes[-1], 2),
                    "rsi2": round(rsi2, 1),
                    "exitDate": add_trading_days(today, 5),
                    "leveraged_or_inverse": bool(entry.get("leveraged_or_inverse")),
                })
            if prev_b is not None and prev_b < 0 <= cur_b <= 1:
                hits.append({
                    "signal": 5, "ticker": t, "date": today,
                    "close": round(closes[-1], 2),
                    "prevPctB": round(prev_b, 2), "pctB": round(cur_b, 2),
                    "exitDate": add_trading_days(today, 5),
                    "leveraged_or_inverse": bool(entry.get("leveraged_or_inverse")),
                })
        except Exception as e:  # noqa: BLE001 - record and continue
            errors.append("%s: %s" % (t, e))
    out = {
        "date": datetime.date.today().isoformat(),
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scanned": len(tickers),
        "hits": hits,
        "errors": errors,
    }
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    with open(os.path.join(ROOT, "docs", "scan-results.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("scanned %d, hits %d, errors %d" % (len(tickers), len(hits), len(errors)))
    for h in hits:
        print("  HIT #%d" % h["signal"], h["ticker"])
    return 0

if __name__ == "__main__":
    sys.exit(main())
