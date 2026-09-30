/**
 * Market data routes: Public.com quotes, Yahoo candles, option chains, AI insights,
 * ticker lookup, and the Market Quality Terminal.
 *
 * Extracted verbatim from server.ts as part of breaking up a 3,400-line file. This
 * block was entirely self-contained — no database access, no shared helpers, no auth
 * middleware — so the move is a pure relocation with no behavioural change. Its only
 * external dependency is the Public.com credentials in the environment.
 */
import express from 'express';

export function createMarketsRouter(): express.Router {
  const router = express.Router();

  // ─── Markets / Live Data (Public.com) ─────────────────────────────────────────

  let publicAccessToken: string | null = null;
  let publicTokenExpiry = 0;

  // Price history for 24h change calculation: symbol → [{price, ts}]
  const priceHistory: Record<string, { price: number; ts: number }[]> = {};
  const HISTORY_THROTTLE = 60 * 1000; // Only store 1 point per minute to save memory

  async function getPublicToken(): Promise<string> {
    if (publicAccessToken && Date.now() < publicTokenExpiry) return publicAccessToken;
    const res = await fetch("https://api.public.com/userapiauthservice/personal/access-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validityInMinutes: 60, secret: process.env.PUBLIC_SECRET_KEY }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Public.com token exchange failed ${res.status}: ${body.slice(0, 200)}`);
    const data = JSON.parse(body) as any;
    publicAccessToken = data.accessToken;
    publicTokenExpiry = Date.now() + 55 * 60 * 1000;
    return publicAccessToken!;
  }

  const MARKET_INSTRUMENTS = [
    { symbol: "BTC",  type: "CRYPTO", name: "Bitcoin",      isCrypto: true },
    { symbol: "SPX",  type: "INDEX",  name: "S&P 500",      isIndex:  true },
    { symbol: "NDX",  type: "INDEX",  name: "Nasdaq-100",   isIndex:  true },
    { symbol: "MSTR", type: "EQUITY", name: "MicroStrategy"                },
    { symbol: "TSLA", type: "EQUITY", name: "Tesla"                        },
    { symbol: "MSFT", type: "EQUITY", name: "Microsoft"                    },
    { symbol: "META", type: "EQUITY", name: "Meta"                         },
    { symbol: "AAPL", type: "EQUITY", name: "Apple"                        },
    { symbol: "AMZN", type: "EQUITY", name: "Amazon"                       },
    { symbol: "NVDA", type: "EQUITY", name: "Nvidia"                       },
    { symbol: "AMD",  type: "EQUITY", name: "AMD"                          },
  ];

  router.get("/api/markets", async (req, res) => {
    try {
      const token     = await getPublicToken();
      const accountId = process.env.PUBLIC_ACCOUNT_ID!;

      const pRes = await fetch(
        `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ instruments: MARKET_INSTRUMENTS.map(i => ({ symbol: i.symbol, type: i.type })) }),
        }
      );

      if (!pRes.ok) {
        const err = await pRes.text();
        throw new Error(`Public.com quotes failed ${pRes.status}: ${err.slice(0, 200)}`);
      }

      const pData = await pRes.json() as any;
      const list: any[] = pData.quotes || [];

      // Build quote map keyed by instrument symbol
      const quoteMap: Record<string, any> = {};
      for (const q of list) {
        const sym = q.instrument?.symbol ?? q.symbol;
        if (sym) quoteMap[sym] = q;
      }

      const now = Date.now();
      const WINDOW = 25 * 60 * 60 * 1000; // 25 hours

      const result = MARKET_INSTRUMENTS.map(inst => {
        const q     = quoteMap[inst.symbol] || {};
        const price = q.last != null ? parseFloat(q.last) : null;

        // Update price history
        if (price != null) {
          const history = priceHistory[inst.symbol] || (priceHistory[inst.symbol] = []);
          const lastEntry = history[history.length - 1];
        
          // Optimization: Only push if enough time passed to avoid array bloat on high traffic
          if (!lastEntry || now - lastEntry.ts > HISTORY_THROTTLE) {
            history.push({ price, ts: now });
          }
          // Trim entries older than 25h
          priceHistory[inst.symbol] = priceHistory[inst.symbol].filter(e => now - e.ts < WINDOW);
        }

        // 24h change: compare with oldest entry ≥ 23h ago, else first available
        let change: number | null = null;
        let changePercent: number | null = null;
        const hist = priceHistory[inst.symbol] || [];
        if (price != null && hist.length > 1) {
          const old = hist.find(e => now - e.ts >= 23 * 60 * 60 * 1000) ?? hist[0];
          if (old && old.price) {
            change = price - old.price;
            changePercent = (change / old.price) * 100;
          }
        }

        const bid    = q.bid    != null ? parseFloat(q.bid)    : null;
        const ask    = q.ask    != null ? parseFloat(q.ask)    : null;
        const spread = bid != null && ask != null ? ask - bid : null;

        return {
          symbol:        inst.symbol,
          name:          inst.name,
          type:          inst.type,
          isCrypto:      (inst as any).isCrypto || false,
          isIndex:       (inst as any).isIndex  || false,
          price,
          change,
          changePercent,
          bid,
          ask,
          spread,
          volume:        q.volume != null ? Number(q.volume) : null,
          lastTimestamp: q.lastTimestamp ?? null,
          outcome:       q.outcome ?? null,
        };
      });

      res.json(result);
    } catch (err) {
      console.error("[Markets] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Market History — 30-day candles (Yahoo Finance v8) ───────────────────────

  const YAHOO_MAP: Record<string, string> = {
    BTC: "BTC-USD", SPX: "^GSPC", NDX: "^NDX",
    MSTR: "MSTR", TSLA: "TSLA", MSFT: "MSFT",
    META: "META", AAPL: "AAPL", AMZN: "AMZN", NVDA: "NVDA", AMD: "AMD",
  };

  const RANGE_MAP: Record<string, { interval: string; range: string }> = {
    "1d": { interval: "5m",  range: "1d"  },
    "1w": { interval: "1h",  range: "5d"  },
    "1m": { interval: "1d",  range: "1mo" },
    "3m": { interval: "1d",  range: "3mo" },
    "6m": { interval: "1wk", range: "6mo" },
    "1y": { interval: "1wk", range: "1y"  },
  };

  function yahooParams(rangeKey: string): { interval: string; range: string } {
    return RANGE_MAP[rangeKey] || RANGE_MAP["1m"];
  }

  // Shared helper: parse Yahoo Finance chart response into candles + pivot levels
  function parseYahooCandles(chartResult: any): { candles: any[]; pivotLevels: any } {
    const timestamps: number[] = chartResult.timestamp || [];
    const q = chartResult.indicators?.quote?.[0] || {};
    const candles = timestamps
      .map((t: number, i: number) => ({
        t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i],
      }))
      .filter((c: any) => c.o != null && c.h != null && c.l != null && c.c != null);

    let pivotLevels: any = null;
    if (candles.length > 0) {
      const periodH = Math.max(...candles.map((c: any) => c.h));
      const periodL = Math.min(...candles.map((c: any) => c.l));
      const periodC = (candles[candles.length - 1] as any).c;
      const p = (periodH + periodL + periodC) / 3;
      pivotLevels = {
        p, r1: 2*p - periodL, r2: p + (periodH - periodL), r3: periodH + 2*(p - periodL),
        s1: 2*p - periodH, s2: p - (periodH - periodL), s3: periodL - 2*(periodH - p),
      };
    }
    return { candles, pivotLevels };
  }

  // Fetch candles for a single Yahoo symbol, returning empty result on failure
  async function fetchYahooCandles(yahooSym: string, interval: string, range: string): Promise<{ candles: any[]; pivotLevels: any }> {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${range}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
    );
    if (!r.ok) return { candles: [], pivotLevels: null };
    const j = await r.json() as any;
    const result = j.chart?.result?.[0];
    if (!result) return { candles: [], pivotLevels: null };
    return parseYahooCandles(result);
  }

  router.get("/api/markets/history", async (req, res) => {
    try {
      const rangeKey = ((req.query.range as string) || "1m").toLowerCase();
      const { interval, range } = yahooParams(rangeKey);
      const singleSymbol = ((req.query.symbol as string) || "").toUpperCase();

      // Single-symbol mode
      if (singleSymbol) {
        const yahooSym = YAHOO_MAP[singleSymbol] || singleSymbol;
        try {
          const { candles, pivotLevels } = await fetchYahooCandles(yahooSym, interval, range);
          return res.json({ symbol: singleSymbol, candles, pivotLevels });
        } catch { return res.json({ symbol: singleSymbol, candles: [], pivotLevels: null }); }
      }

      const results = await Promise.all(
        Object.entries(YAHOO_MAP).map(async ([sym, yahooSym]) => {
          try {
            const { candles, pivotLevels } = await fetchYahooCandles(yahooSym, interval, range);
            return { symbol: sym, candles, pivotLevels };
          } catch { return { symbol: sym, candles: [], pivotLevels: null }; }
        })
      );
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Single-symbol history endpoint ──────────────────────────────────────────

  router.get("/api/markets/history/:symbol", async (req, res) => {
    try {
      const sym = (req.params.symbol || "").toUpperCase();
      const rangeKey = ((req.query.range as string) || "1m").toLowerCase();
      const { interval, range } = yahooParams(rangeKey);

      // Check YAHOO_MAP first, then fallback to the symbol itself (or CRYPTO convention)
      let yahooSym = YAHOO_MAP[sym];
      if (!yahooSym) {
        yahooSym = sym;
      }

      const { candles, pivotLevels } = await fetchYahooCandles(yahooSym, interval, range);
      res.json({ symbol: sym, candles, pivotLevels });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Options — most traded contracts (Public.com option-chain) ────────────────

  function nextMonthlyExpiry(): string {
    const now = new Date();
    for (let mo = 0; mo <= 3; mo++) {
      const d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      let fri = 0;
      while (fri < 3) { if (d.getDay() === 5) fri++; if (fri < 3) d.setDate(d.getDate() + 1); }
      if (d.getTime() - now.getTime() > 7 * 864e5) return d.toISOString().split("T")[0];
    }
    return "";
  }

  const EQUITY_SYMS = ["MSTR", "TSLA", "MSFT", "META", "AAPL", "AMZN", "NVDA", "AMD"];
  let optionsCache: any = null;
  let optionsCacheTime = 0;

  router.get("/api/markets/options", async (_req, res) => {
    try {
      if (optionsCache && Date.now() - optionsCacheTime < 5 * 60 * 1000) return res.json(optionsCache);

      const token   = await getPublicToken();
      const acctId  = process.env.PUBLIC_ACCOUNT_ID!;
      const expiry  = nextMonthlyExpiry();

      const results = await Promise.all(
        EQUITY_SYMS.map(async (sym) => {
          try {
            const r = await fetch(
              `https://api.public.com/userapigateway/marketdata/${acctId}/option-chain`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ instrument: { symbol: sym, type: "EQUITY" }, expirationDate: expiry }),
              }
            );
            if (!r.ok) return { symbol: sym, expiry, contracts: [] };
            const data = await r.json() as any;
            const calls = (data.calls || []).map((o: any) => ({ ...o, side: "CALL" }));
            const puts  = (data.puts  || []).map((o: any) => ({ ...o, side: "PUT" }));
            const top = [...calls, ...puts]
              .filter((o: any) => (o.volume || 0) > 0)
              .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
              .slice(0, 8)
              .map((o: any) => {
                const osiSym: string = o.instrument?.symbol || "";
                const strike = osiSym.length >= 8 ? parseInt(osiSym.slice(-8)) / 1000 : null;
                return {
                  symbol: osiSym, side: o.side, strike,
                  last:  o.last  != null ? parseFloat(o.last)  : null,
                  bid:   o.bid   != null ? parseFloat(o.bid)   : null,
                  ask:   o.ask   != null ? parseFloat(o.ask)   : null,
                  volume: o.volume || 0,
                  openInterest: o.openInterest || 0,
                };
              });
            return { symbol: sym, expiry, contracts: top };
          } catch { return { symbol: sym, expiry, contracts: [] }; }
        })
      );

      optionsCache = results;
      optionsCacheTime = Date.now();
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Market Insights — AI-generated analysis from live data ──────────────────

  let insightsCache: { text: string; ts: number } | null = null;
  const INSIGHTS_TTL = 10 * 60 * 1000; // 10 minutes

  router.get("/api/markets/insights", async (_req, res) => {
    if (insightsCache && Date.now() - insightsCache.ts < INSIGHTS_TTL) {
      return res.json({ text: insightsCache.text, cached: true, generatedAt: new Date(insightsCache.ts).toISOString() });
    }

    try {
      // Gather live prices
      const token     = await getPublicToken();
      const accountId = process.env.PUBLIC_ACCOUNT_ID!;
      const pRes = await fetch(
        `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ instruments: MARKET_INSTRUMENTS.map(i => ({ symbol: i.symbol, type: i.type })) }),
        }
      );
      const pData = pRes.ok ? await pRes.json() as any : { quotes: [] };
      const quoteMap: Record<string, any> = {};
      for (const q of (pData.quotes || [])) {
        const sym = q.instrument?.symbol ?? q.symbol;
        if (sym) quoteMap[sym] = q;
      }

      // Gather 30-day history + pivots
      const historyData = await Promise.all(
        Object.entries(YAHOO_MAP).map(async ([sym, yahooSym]) => {
          try {
            const r = await fetch(
              `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1mo`,
              { headers: { "User-Agent": "Mozilla/5.0" } }
            );
            if (!r.ok) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
            const j = await r.json() as any;
            const result = j.chart?.result?.[0];
            if (!result) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
            const ts: number[] = result.timestamp || [];
            const q2 = result.indicators?.quote?.[0] || {};
            const candles = ts.map((t, i) => ({
              o: q2.open?.[i], h: q2.high?.[i], l: q2.low?.[i], c: q2.close?.[i],
            })).filter((c: any) => c.o != null);
            if (!candles.length) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
            const last  = candles[candles.length - 1] as any;
            const first = candles[0] as any;
            const hi30  = Math.max(...candles.map((c: any) => c.h));
            const lo30  = Math.min(...candles.map((c: any) => c.l));
            const p = (last.h + last.l + last.c) / 3;
            return {
              sym, open30: first.o, close30: last.c, hi30, lo30,
              pivot: { p, r1: 2*p - last.l, s1: 2*p - last.h },
            };
          } catch { return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null }; }
        })
      );

      // Build a compact data snapshot for the prompt
      const lines = MARKET_INSTRUMENTS.map(inst => {
        const q    = quoteMap[inst.symbol] || {};
        const price = q.last != null ? parseFloat(q.last) : null;
        const h    = historyData.find(d => d.sym === inst.symbol);
        const pct30 = h?.open30 && price ? ((price - h.open30) / h.open30 * 100).toFixed(1) : "?";
        const pivot = h?.pivot ? `P=${h.pivot.p.toFixed(0)} S1=${h.pivot.s1.toFixed(0)} R1=${h.pivot.r1.toFixed(0)}` : "";
        const priceStr = price != null ? (inst.isIndex ? price.toFixed(0) : `$${price.toFixed(2)}`) : "N/A";
        const rangeStr = h?.hi30 ? `30d range $${h.lo30?.toFixed(0)}–$${h.hi30?.toFixed(0)}` : "";
        return `${inst.symbol} (${inst.name}): ${priceStr} | ${pct30}% vs 30d ago | ${rangeStr} | ${pivot}`;
      });

      const now = new Date().toUTCString();
      const prompt = `You are a sharp, concise macro/markets analyst. Today is ${now}.

  Here is live market data:
  ${lines.join('\n')}

  Write a tight, actionable market insights brief (aim for ~300 words). Structure it as:
  1. **Overall Tone** — one sentence: risk-on, risk-off, or mixed? Why?
  2. **Key Setups** — 3–5 bullet points, each covering a specific instrument or theme. Call out pivot levels, breakout/breakdown risks, relative strength/weakness, and what to watch.
  3. **Watch List** — 2–3 specific price levels or catalysts that will define the next move.

  Be direct. No filler. Use the actual numbers from the data. Format in markdown.`;

      const anthropic = new (await import("@anthropic-ai/sdk")).default();
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });

      const text = (msg.content[0] as any).text as string;
      insightsCache = { text, ts: Date.now() };
      res.json({ text, cached: false, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("[Insights]", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Ticker Lookup — arbitrary symbol on demand ───────────────────────────────

  router.get("/api/markets/lookup", async (req, res) => {
    const raw  = ((req.query.symbol as string) || "").trim().toUpperCase();
    const type = ((req.query.type  as string) || "EQUITY").toUpperCase();
    if (!raw) return res.status(400).json({ error: "symbol required" });

    try {
      const token     = await getPublicToken();
      const accountId = process.env.PUBLIC_ACCOUNT_ID!;

      // Try the supplied type first; if that gets no quote, try the other two
      const tryTypes = type === "CRYPTO"
        ? ["CRYPTO", "EQUITY", "INDEX"]
        : type === "INDEX"
          ? ["INDEX", "EQUITY", "CRYPTO"]
          : ["EQUITY", "CRYPTO", "INDEX"];

      let quoteData: any = null;
      let resolvedType = type;

      for (const t of tryTypes) {
        const qRes = await fetch(
          `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ instruments: [{ symbol: raw, type: t }] }),
          }
        );
        if (!qRes.ok) continue;
        const qData = await qRes.json() as any;
        const q = (qData.quotes || [])[0];
        if (q && (q.last != null || q.bid != null || q.ask != null)) {
          quoteData = q;
          resolvedType = t;
          break;
        }
      }

      if (!quoteData) return res.status(404).json({ error: `No quote found for ${raw}` });

      const price  = quoteData.last  != null ? parseFloat(quoteData.last)  : null;
      const bid    = quoteData.bid   != null ? parseFloat(quoteData.bid)   : null;
      const ask    = quoteData.ask   != null ? parseFloat(quoteData.ask)   : null;
      const spread = bid != null && ask != null ? ask - bid : null;

      const tile = {
        symbol:        raw,
        name:          quoteData.instrument?.description || raw,
        type:          resolvedType,
        isCrypto:      resolvedType === "CRYPTO",
        isIndex:       resolvedType === "INDEX",
        price,
        change:        null,
        changePercent: null,
        bid,
        ask,
        spread,
        volume:        quoteData.volume != null ? Number(quoteData.volume) : null,
        lastTimestamp: quoteData.lastTimestamp ?? null,
      };

      // Fetch candle history from Yahoo Finance
      const lookupRange = ((req.query.range as string) || "1m").toLowerCase();
      const { interval: lkInterval, range: lkRange } = yahooParams(lookupRange);
      const yahooSym = resolvedType === "CRYPTO" ? `${raw}-USD` : raw;
      let candles: any[] = [];
      let pivotLevels: any = null;
      try {
        const history = await fetchYahooCandles(yahooSym, lkInterval, lkRange);
        candles = history.candles;
        pivotLevels = history.pivotLevels;
      } catch { /* history is optional */ }

      res.json({ tile, candles, pivotLevels });
    } catch (err) {
      console.error("[Lookup]", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Market Quality Terminal ────────────────────────────────────────────────────

  let terminalCache: { data: any; ts: number } | null = null;
  const TERMINAL_TTL = 5 * 60 * 1000; // 5 minutes

  let terminalAnalysisCache: { text: string; ts: number } | null = null;
  const TERMINAL_ANALYSIS_TTL = 10 * 60 * 1000; // 10 minutes

  const TERMINAL_SYMBOLS = [
    "^GSPC", "^NDX", "^VIX", "DX-Y.NYB", "^TNX", "GLD",
    "XLE", "XLF", "XLK", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC",
  ];

  const SECTOR_META: Record<string, string> = {
    XLE: "Energy", XLF: "Financials", XLK: "Technology", XLV: "Health Care",
    XLI: "Industrials", XLU: "Utilities", XLY: "Consumer Disc", XLP: "Consumer Staples",
    XLB: "Materials", XLRE: "Real Estate", XLC: "Communications",
  };

  async function fetchYahooChart(symbol: string, interval = "1d", range = "3mo") {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json() as any;
    const result = j.chart?.result?.[0];
    if (!result) return null;
    const timestamps: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const closes: number[] = [];
    const candles: { t: number; o: number; h: number; l: number; c: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (q.close?.[i] != null) {
        closes.push(q.close[i]);
        candles.push({ t: timestamps[i] * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close[i] });
      }
    }
    const meta = result.meta || {};
    const price = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : null);
    return { symbol, price, prevClose, closes, candles, meta };
  }

  function sma(arr: number[], period: number): number | null {
    if (arr.length < period) return null;
    const slice = arr.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  async function buildTerminalData() {
    // Fetch all symbols in parallel
    const results = await Promise.all(TERMINAL_SYMBOLS.map(s => fetchYahooChart(s)));
    const dataMap: Record<string, NonNullable<Awaited<ReturnType<typeof fetchYahooChart>>>> = {};
    for (let i = 0; i < TERMINAL_SYMBOLS.length; i++) {
      if (results[i]) dataMap[TERMINAL_SYMBOLS[i]] = results[i]!;
    }

    const spx = dataMap["^GSPC"];
    const ndx = dataMap["^NDX"];
    const vix = dataMap["^VIX"];
    const dxy = dataMap["DX-Y.NYB"];
    const tny = dataMap["^TNX"];
    const gld = dataMap["GLD"];

    // ─── Ticker bar ────────────────────────────────────────────────────────
    const tickerItems = [
      { sym: "SPX", data: spx },
      { sym: "NDX", data: ndx },
      { sym: "VIX", data: vix },
      { sym: "DXY", data: dxy },
      { sym: "10Y", data: tny },
      { sym: "GLD", data: gld },
    ].map(({ sym, data }) => {
      if (!data) return { symbol: sym, price: 0, change: 0, changePercent: 0 };
      const change = data.prevClose ? data.price - data.prevClose : 0;
      const changePercent = data.prevClose ? change / data.prevClose : 0;
      return { symbol: sym, price: +(data.price?.toFixed(2) ?? 0), change: +change.toFixed(2), changePercent: +changePercent.toFixed(4) };
    });

    // ─── VIX scoring ──────────────────────────────────────────────────────
    const vixLevel = vix?.price ?? 20;
    let vixScore: number;
    if (vixLevel < 15) vixScore = 100;
    else if (vixLevel < 20) vixScore = 75;
    else if (vixLevel < 25) vixScore = 50;
    else if (vixLevel < 30) vixScore = 25;
    else vixScore = 0;

    const vixCloses = vix?.closes ?? [];
    const vix5d = sma(vixCloses, 5);
    const vixTrend = vix5d && vixLevel > vix5d ? "Rising" : "Falling";
    const vixTrendSignal = vixTrend === "Rising" ? "negative" : "positive";

    // VIX IV percentile approximation: where current VIX is vs 3-month range
    const vixHi = vixCloses.length ? Math.max(...vixCloses) : vixLevel;
    const vixLo = vixCloses.length ? Math.min(...vixCloses) : vixLevel;
    const vixIvPercentile = vixHi !== vixLo ? Math.round(((vixLevel - vixLo) / (vixHi - vixLo)) * 100) : 50;
    const vixIvSignal = vixIvPercentile > 80 ? "elevated" : vixIvPercentile > 60 ? "normal" : "low";

    // Put/Call ratio approximation from VIX level
    const putCallRatio = +(0.7 + (vixLevel - 15) * 0.02).toFixed(2);
    const putCallSignal = putCallRatio > 1.0 ? "elevated" : putCallRatio > 0.85 ? "normal" : "low";

    // ─── Trend scoring ────────────────────────────────────────────────────
    const spxCloses = spx?.closes ?? [];
    const spxPrice = spx?.price ?? 0;
    const spx20d = sma(spxCloses, 20);
    const spx50d = sma(spxCloses, 50);
    // 200d: we only have ~63 days, approximate from what we have
    const spx200d = spxCloses.length >= 50 ? sma(spxCloses, spxCloses.length) : null;

    let trendScore = 0;
    if (spx200d && spxPrice > spx200d) trendScore += 30;
    if (spx50d && spxPrice > spx50d) trendScore += 20;
    if (spx20d && spxPrice > spx20d) trendScore += 10;

    const ndxCloses = ndx?.closes ?? [];
    const ndxPrice = ndx?.price ?? 0;
    const ndx20d = sma(ndxCloses, 20);
    const ndx50d = sma(ndxCloses, 50);
    const ndx200d = ndxCloses.length >= 50 ? sma(ndxCloses, ndxCloses.length) : null;
    if (ndx200d && ndxPrice > ndx200d) trendScore += 15;
    if (ndx50d && ndxPrice > ndx50d) trendScore += 10;
    if (ndx20d && ndxPrice > ndx20d) trendScore += 5;
    // Normalize: max raw = 90, scale to 100
    trendScore = Math.min(100, Math.round(trendScore * 100 / 90));

    const spxVs20d = spx20d ? +((spxPrice - spx20d) / spx20d * 100).toFixed(2) : 0;
    const spxVs50d = spx50d ? +((spxPrice - spx50d) / spx50d * 100).toFixed(2) : 0;
    const spxVs200d = spx200d ? +((spxPrice - spx200d) / spx200d * 100).toFixed(2) : 0;

    function trendSignalFor(val: number) {
      if (val > 2) return "strong";
      if (val > 0) return "intact";
      if (val > -2) return "weak";
      return "broken";
    }

    // QQQ regime
    const qqqAbove50 = ndx50d && ndxPrice > ndx50d;
    const qqqAbove20 = ndx20d && ndxPrice > ndx20d;
    const qqqTrend = qqqAbove50 && qqqAbove20 ? "uptrend" : qqqAbove20 ? "correcting" : "downtrend";
    const spxAbove50 = spx50d && spxPrice > spx50d;
    const spxAbove20 = spx20d && spxPrice > spx20d;
    const regime = spxAbove50 && spxAbove20 ? "uptrend" : spxAbove20 ? "correcting" : "downtrend";

    // ─── Breadth scoring ──────────────────────────────────────────────────
    const sectorSymbols = ["XLE", "XLF", "XLK", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC"];
    let above50dCount = 0;
    let above200dCount = 0;
    for (const sym of sectorSymbols) {
      const d = dataMap[sym];
      if (!d) continue;
      const c = d.closes;
      const ma50 = sma(c, 50);
      const ma200 = c.length >= 50 ? sma(c, c.length) : null;
      if (ma50 && d.price > ma50) above50dCount++;
      if (ma200 && d.price > ma200) above200dCount++;
    }
    const breadthScore = Math.round((above50dCount / 11) * 100);
    const pctAbove50d = Math.round((above50dCount / 11) * 100);
    const pctAbove200d = Math.round((above200dCount / 11) * 100);
    const pctAbove50dSignal = pctAbove50d >= 70 ? "strong" : pctAbove50d >= 50 ? "neutral" : pctAbove50d >= 30 ? "weak" : "very weak";
    const pctAbove200dSignal = pctAbove200d >= 70 ? "strong" : pctAbove200d >= 50 ? "neutral" : pctAbove200d >= 30 ? "weak" : "very weak";

    // NYSE A/D approximation: use broad sector price vs 20d MA
    let advancers = 0;
    let decliners = 0;
    for (const sym of sectorSymbols) {
      const d = dataMap[sym];
      if (!d) continue;
      const ma20 = sma(d.closes, 20);
      if (ma20 && d.price > ma20) advancers++;
      else decliners++;
    }
    const nyseAd = advancers - decliners > 0 ? +((advancers - decliners) / 11).toFixed(2) : -+((decliners - advancers) / 11).toFixed(2);
    const nyseAdSignal = nyseAd > 0.3 ? "positive" : nyseAd > -0.3 ? "neutral" : "negative";

    // New highs/lows: count sectors at 3-month high vs 3-month low
    let newHighs = 0;
    let newLows = 0;
    for (const sym of sectorSymbols) {
      const d = dataMap[sym];
      if (!d || !d.closes.length) continue;
      const hi = Math.max(...d.closes);
      const lo = Math.min(...d.closes);
      const threshold = (hi - lo) * 0.05;
      if (d.price >= hi - threshold) newHighs++;
      if (d.price <= lo + threshold) newLows++;
    }
    const newHighsLows = `${newHighs}/${newLows * 15}`;
    const newHighsLowsSignal = newHighs > newLows ? "good" : newHighs === newLows ? "neutral" : "poor";

    // ─── Momentum scoring ─────────────────────────────────────────────────
    const sectorPerf: { name: string; symbol: string; change: number }[] = [];
    let sectorsPositive = 0;
    for (const sym of sectorSymbols) {
      const d = dataMap[sym];
      if (!d) { sectorPerf.push({ name: SECTOR_META[sym], symbol: sym, change: 0 }); continue; }
      const c = d.closes;
      const fiveDayAgo = c.length > 5 ? c[c.length - 6] : c[0];
      const change = fiveDayAgo ? +((d.price - fiveDayAgo) / fiveDayAgo * 100).toFixed(2) : 0;
      if (change > 0) sectorsPositive++;
      sectorPerf.push({ name: SECTOR_META[sym], symbol: sym, change });
    }
    const momentumScore = Math.round((sectorsPositive / 11) * 100);
    sectorPerf.sort((a, b) => b.change - a.change);
    const leader = sectorPerf[0] || { name: "N/A", change: 0 };
    const laggard = sectorPerf[sectorPerf.length - 1] || { name: "N/A", change: 0 };
    const sectorsSignal = sectorsPositive >= 8 ? "strong" : sectorsPositive >= 5 ? "neutral" : sectorsPositive >= 3 ? "weak" : "very weak";
    const participation = sectorsPositive >= 8 ? "broad" : sectorsPositive >= 5 ? "moderate" : "low";

    // ─── Macro scoring ────────────────────────────────────────────────────
    const tenYearYield = tny?.price ?? 0;
    const tnyCloses = tny?.closes ?? [];
    const tny5d = sma(tnyCloses, 5);
    const tenYearSignal = tny5d && tenYearYield > tny5d + 0.05 ? "rising" : tny5d && tenYearYield < tny5d - 0.05 ? "falling" : "stable";

    const dxyPrice = dxy?.price ?? 0;
    const dxyCloses = dxy?.closes ?? [];
    const dxy5d = sma(dxyCloses, 5);
    const dxySignal = dxy5d && dxyPrice > dxy5d + 0.3 ? "strengthening" : dxy5d && dxyPrice < dxy5d - 0.3 ? "weakening" : "stable";

    let macroScore = 50; // start at neutral
    if (tenYearSignal === "stable") macroScore += 20;
    else if (tenYearSignal === "falling") macroScore += 10;
    else macroScore -= 15;
    if (dxySignal === "stable") macroScore += 15;
    else if (dxySignal === "weakening") macroScore += 10;
    else macroScore -= 10;
    if (vixTrend === "Falling") macroScore += 15;
    else macroScore -= 15;
    macroScore = Math.max(0, Math.min(100, macroScore));

    // FOMC detection: crude check for upcoming FOMC dates
    const today = new Date();
    // 2026 FOMC dates (approximate)
    const fomcDates = [
      "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
      "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16",
    ];
    let fomc = "None scheduled";
    let fomcSignal = "clear";
    for (const fd of fomcDates) {
      const diff = (new Date(fd).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      if (diff >= -1 && diff <= 0) { fomc = "TODAY"; fomcSignal = "event-risk"; break; }
      if (diff > 0 && diff <= 1) { fomc = "TOMORROW"; fomcSignal = "event-risk"; break; }
      if (diff > 1 && diff <= 7) { fomc = `In ${Math.ceil(diff)} days`; fomcSignal = "caution"; break; }
    }
    if (fomcSignal === "event-risk") macroScore = Math.max(0, macroScore - 20);

    const fedStance = "Hold 4.25-4.50%"; // manually updated or could be derived

    // ─── Execution Window ─────────────────────────────────────────────────
    // Check if breakouts are working: SPX made new 5d high and held it
    const spx5dHigh = spxCloses.length >= 5 ? Math.max(...spxCloses.slice(-5)) : spxPrice;
    const breakoutsWorking = spxPrice >= spx5dHigh * 0.998;
    const breakoutsSignal = breakoutsWorking ? "working" : "failing";

    // Leaders holding: are top sectors maintaining gains?
    const topSectors = sectorPerf.slice(0, 3);
    const leadersHolding = topSectors.filter(s => s.change > 0).length >= 2;
    const leadersSignal = leadersHolding ? "holding" : "fading";

    // Pullbacks bought: check if SPX bounced from 20d MA
    const pullbacksBought = spx20d && spxPrice > spx20d && Math.abs(spxVs20d) < 3;
    const pullbacksSignal = pullbacksBought ? "support" : "failing";

    // Follow through: volume trend approximation
    const followThrough = trendScore > 60 && momentumScore > 50 ? "Strong" : trendScore > 40 ? "Weak" : "None";
    const followThroughSignal = followThrough === "Strong" ? "conviction" : followThrough === "Weak" ? "low conviction" : "absent";

    const execScore = Math.round(
      (breakoutsWorking ? 25 : 0) +
      (leadersHolding ? 25 : 0) +
      (pullbacksBought ? 25 : 0) +
      (followThrough === "Strong" ? 25 : followThrough === "Weak" ? 12 : 0)
    );

    // ─── Total score ──────────────────────────────────────────────────────
    const volWeight = 0.20;
    const trendWeight = 0.25;
    const breadthWeight = 0.20;
    const momWeight = 0.20;
    const macroWeight = 0.15;

    const totalScore = Math.round(
      vixScore * volWeight +
      trendScore * trendWeight +
      breadthScore * breadthWeight +
      momentumScore * momWeight +
      macroScore * macroWeight
    );

    let shouldTrade = totalScore >= 60;
    let decisionLabel = totalScore >= 60 ? "Trade" : totalScore >= 40 ? "Caution" : "Avoid Trading";

    return {
      ticker: tickerItems,
      decision: { shouldTrade, score: totalScore, label: decisionLabel },
      volatility: {
        score: vixScore,
        vixLevel: +vixLevel.toFixed(2),
        vixTrend,
        vixTrendSignal,
        vixIvPercentile,
        vixIvSignal,
        putCallRatio,
        putCallSignal,
      },
      trend: {
        score: trendScore,
        spxVs20d: { value: spxVs20d, signal: trendSignalFor(spxVs20d) },
        spxVs50d: { value: spxVs50d, signal: trendSignalFor(spxVs50d) },
        spxVs200d: { value: spxVs200d, signal: trendSignalFor(spxVs200d) },
        qqqTrend,
        regime,
      },
      breadth: {
        score: breadthScore,
        pctAbove50d,
        pctAbove50dSignal,
        pctAbove200d,
        pctAbove200dSignal,
        nyseAd,
        nyseAdSignal,
        newHighsLows,
        newHighsLowsSignal,
      },
      momentum: {
        score: momentumScore,
        sectorsPositive,
        sectorsTotal: 11,
        sectorsSignal,
        leader: { name: leader.name, change: leader.change },
        laggard: { name: laggard.name, change: laggard.change },
        participation,
      },
      macro: {
        score: macroScore,
        fomc,
        fomcSignal,
        tenYearYield: +tenYearYield.toFixed(2),
        tenYearSignal,
        dxy: +dxyPrice.toFixed(2),
        dxySignal,
        fedStance,
        geopolitical: "Monitor global tensions",
      },
      executionWindow: {
        score: execScore,
        breakoutsWorking: { answer: breakoutsWorking ? "Yes" : "No", signal: breakoutsSignal },
        leadersHolding: { answer: leadersHolding ? "Yes" : "No", signal: leadersSignal },
        pullbacksBought: { answer: pullbacksBought ? "Yes" : "No", signal: pullbacksSignal },
        followThrough: { answer: followThrough, signal: followThroughSignal },
      },
      sectors: sectorPerf,
      scoringWeights: {
        volatility: { weight: Math.round(vixScore * volWeight), label: `+${Math.round(vixScore * volWeight)}` },
        momentum: { weight: Math.round(momentumScore * momWeight), label: `+${Math.round(momentumScore * momWeight)}` },
        trend: { weight: Math.round(trendScore * trendWeight), label: `+${Math.round(trendScore * trendWeight)}` },
        breadth: { weight: Math.round(breadthScore * breadthWeight), label: `+${Math.round(breadthScore * breadthWeight)}` },
        macro: { weight: Math.round(macroScore * macroWeight), label: `+${Math.round(macroScore * macroWeight)}` },
      },
      updatedAt: new Date().toISOString(),
    };
  }

  router.get("/api/terminal", async (_req, res) => {
    if (terminalCache && Date.now() - terminalCache.ts < TERMINAL_TTL) {
      return res.json(terminalCache.data);
    }
    try {
      const data = await buildTerminalData();
      terminalCache = { data, ts: Date.now() };
      res.json(data);
    } catch (err) {
      console.error("[Terminal]", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/api/terminal/analysis", async (_req, res) => {
    if (terminalAnalysisCache && Date.now() - terminalAnalysisCache.ts < TERMINAL_ANALYSIS_TTL) {
      return res.json({ text: terminalAnalysisCache.text, cached: true, generatedAt: new Date(terminalAnalysisCache.ts).toISOString() });
    }
    try {
      // Get terminal data first
      let data: any;
      if (terminalCache && Date.now() - terminalCache.ts < TERMINAL_TTL) {
        data = terminalCache.data;
      } else {
        data = await buildTerminalData();
        terminalCache = { data, ts: Date.now() };
      }

      const prompt = `You are an elite trading floor strategist assessing market quality conditions. Today is ${new Date().toUTCString()}.

  Here is the current Market Quality Terminal data:
  - Overall Score: ${data.decision.score}/100 — Decision: ${data.decision.label}
  - VIX: ${data.volatility.vixLevel} (${data.volatility.vixTrend}), IV Percentile: ${data.volatility.vixIvPercentile}%
  - SPX vs 20d: ${data.trend.spxVs20d.value}%, vs 50d: ${data.trend.spxVs50d.value}%, vs 200d: ${data.trend.spxVs200d.value}%
  - Market Regime: ${data.trend.regime}
  - Breadth: ${data.breadth.pctAbove50d}% above 50d MA, ${data.breadth.pctAbove200d}% above 200d MA
  - Sector Momentum: ${data.momentum.sectorsPositive}/${data.momentum.sectorsTotal} positive, Leader: ${data.momentum.leader.name} (${data.momentum.leader.change}%), Laggard: ${data.momentum.laggard.name} (${data.momentum.laggard.change}%)
  - 10Y Yield: ${data.macro.tenYearYield}% (${data.macro.tenYearSignal}), DXY: ${data.macro.dxy} (${data.macro.dxySignal})
  - FOMC: ${data.macro.fomc}
  - Execution: Breakouts ${data.executionWindow.breakoutsWorking.answer}, Leaders ${data.executionWindow.leadersHolding.answer}, Pullbacks Bought ${data.executionWindow.pullbacksBought.answer}

  Sectors (5d change): ${data.sectors.map((s: any) => `${s.name}: ${s.change}%`).join(', ')}

  Write a 3-4 paragraph market quality assessment. Be direct and authoritative:
  1. Overall market quality verdict — should active traders be engaged or sitting out?
  2. Key factors driving this assessment — what specific conditions support or undermine trading?
  3. Tactical recommendations — what setups to look for, what to avoid, position sizing guidance.
  4. Key risk to monitor in the next 24-48 hours.

  Use plain text, no markdown headers. Be concise but thorough.`;

      const anthropic = new (await import("@anthropic-ai/sdk")).default();
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const text = (msg.content[0] as any).text as string;
      terminalAnalysisCache = { text, ts: Date.now() };
      res.json({ text, cached: false, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("[Terminal Analysis]", err);
      res.status(500).json({ error: String(err) });
    }
  });


  return router;
}
