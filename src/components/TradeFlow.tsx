import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Pause, Play, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { BackButton } from './BackButton';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Trade {
  id: number;
  time: number;
  price: number;
  qty: number;
  isBuy: boolean;
  usdValue: number;
  exchange: string;
  exchangeColor: string;
}

interface VolumeBucket {
  buyVol: number;
  sellVol: number;
  timestamp: number;
}

interface Stats {
  tradesPerSec: number;
  buyVolume60s: number;
  sellVolume60s: number;
  largestTrade: Trade | null;
  avgTradeSize: number;
  largeAlerts: Trade[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

interface ExchangeConfig {
  name: string;
  color: string;
  getUrl: (pair: string) => string;
  getSubscribeMsg?: (pair: string) => string;
  parseTrade: (msg: any) => { price: number; qty: number; isBuy: boolean; time: number } | null;
  pairMap: Record<string, string>;
}

const EXCHANGES: ExchangeConfig[] = [
  {
    name: 'Coinbase',
    color: '#3b82f6',
    getUrl: () => 'wss://ws-feed.exchange.coinbase.com',
    getSubscribeMsg: (pair) => JSON.stringify({ type: 'subscribe', product_ids: [pair], channels: ['matches'] }),
    parseTrade: (msg) => {
      if (msg.type !== 'match' && msg.type !== 'last_match') return null;
      return { price: parseFloat(msg.price), qty: parseFloat(msg.size), isBuy: msg.side === 'buy', time: new Date(msg.time).getTime() };
    },
    pairMap: { btcusd: 'BTC-USD', ethusd: 'ETH-USD', solusd: 'SOL-USD', xrpusd: 'XRP-USD', dogeusd: 'DOGE-USD' },
  },
  {
    name: 'Kraken',
    color: '#7c3aed',
    getUrl: () => 'wss://ws.kraken.com',
    getSubscribeMsg: (pair) => JSON.stringify({ event: 'subscribe', pair: [pair], subscription: { name: 'trade' } }),
    parseTrade: (msg) => {
      if (!Array.isArray(msg) || msg.length < 4) return null;
      const trades = msg[1];
      if (!Array.isArray(trades) || !trades.length) return null;
      const t = trades[trades.length - 1];
      return { price: parseFloat(t[0]), qty: parseFloat(t[1]), isBuy: t[3] === 'b', time: parseFloat(t[2]) * 1000 };
    },
    pairMap: { btcusd: 'XBT/USD', ethusd: 'ETH/USD', solusd: 'SOL/USD', xrpusd: 'XRP/USD', dogeusd: 'DOGE/USD' },
  },
  {
    name: 'Bitstamp',
    color: '#22c55e',
    getUrl: () => 'wss://ws.bitstamp.net',
    getSubscribeMsg: (pair) => JSON.stringify({ event: 'bts:subscribe', data: { channel: `live_trades_${pair}` } }),
    parseTrade: (msg) => {
      if (msg.event !== 'trade' || !msg.data) return null;
      const d = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
      return { price: parseFloat(d.price_str || d.price), qty: parseFloat(d.amount_str || d.amount), isBuy: d.type === 0, time: (d.timestamp ? d.timestamp * 1000 : Date.now()) };
    },
    pairMap: { btcusd: 'btcusd', ethusd: 'ethusd', solusd: 'solusd', xrpusd: 'xrpusd', dogeusd: 'dogeusd' },
  },
  {
    name: 'Bitfinex',
    color: '#eab308',
    getUrl: () => 'wss://api-pub.bitfinex.com/ws/2',
    getSubscribeMsg: (pair) => JSON.stringify({ event: 'subscribe', channel: 'trades', symbol: pair }),
    parseTrade: (msg) => {
      // Bitfinex sends: [CHANNEL_ID, "te", [ID, MTS, AMOUNT, PRICE]] for trade executed
      if (!Array.isArray(msg) || msg[1] !== 'te' || !Array.isArray(msg[2])) return null;
      const t = msg[2];
      const amount = t[2];
      return { price: Math.abs(t[3]), qty: Math.abs(amount), isBuy: amount > 0, time: t[1] };
    },
    pairMap: { btcusd: 'tBTCUSD', ethusd: 'tETHUSD', solusd: 'tSOLUSD', xrpusd: 'tXRPUSD', dogeusd: 'tDOGEUSD' },
  },
];

const SYMBOLS = [
  { label: 'BTC/USD', value: 'btcusd', decimals: 2 },
  { label: 'ETH/USD', value: 'ethusd', decimals: 2 },
  { label: 'SOL/USD', value: 'solusd', decimals: 4 },
  { label: 'XRP/USD', value: 'xrpusd', decimals: 4 },
  { label: 'DOGE/USD', value: 'dogeusd', decimals: 6 },
];

const MAX_TRADES = 500;
const LARGE_TRADE_THRESHOLD = 50_000;
const ALERT_THRESHOLD = 100_000;
const VOLUME_WINDOW = 60;
const UI_INTERVAL = 100; // 10fps

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatQty(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

// ── Component ──────────────────────────────────────────────────────────────────

export const TradeFlow = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Rendered state (updated at 10fps)
  const [displayTrades, setDisplayTrades] = useState<Trade[]>([]);
  const [displayStats, setDisplayStats] = useState<Stats>({
    tradesPerSec: 0, buyVolume60s: 0, sellVolume60s: 0,
    largestTrade: null, avgTradeSize: 0, largeAlerts: [],
  });
  const [displayBuckets, setDisplayBuckets] = useState<VolumeBucket[]>([]);
  const [displayDelta, setDisplayDelta] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);

  const [enabledExchanges, setEnabledExchanges] = useState<Set<string>>(() => new Set(EXCHANGES.map(e => e.name)));

  // Refs for accumulation (not triggering re-renders)
  const tradesRef = useRef<Trade[]>([]);
  const bucketsRef = useRef<Map<number, VolumeBucket>>(new Map());
  const tradeCountRef = useRef<number[]>([]); // timestamps of recent trades
  const largeAlertsRef = useRef<Trade[]>([]);
  const wsRefs = useRef<WebSocket[]>([]);
  const pausedRef = useRef(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradeIdRef = useRef(0);
  const connectedCountRef = useRef(0);

  pausedRef.current = paused;

  const toggleExchange = useCallback((name: string) => {
    setEnabledExchanges(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // ── Process a trade from any exchange ──────────────────────────────────────

  const processTrade = useCallback((price: number, qty: number, isBuy: boolean, time: number, exchangeName: string, exchangeColor: string) => {
    if (pausedRef.current) return;
    const usdValue = price * qty;

    const trade: Trade = {
      id: tradeIdRef.current++,
      time, price, qty, isBuy, usdValue,
      exchange: exchangeName,
      exchangeColor,
    };

    tradesRef.current = [trade, ...tradesRef.current].slice(0, MAX_TRADES);

    const bucketKey = Math.floor(time / 1000);
    const existing = bucketsRef.current.get(bucketKey);
    if (existing) {
      if (isBuy) existing.buyVol += usdValue;
      else existing.sellVol += usdValue;
    } else {
      bucketsRef.current.set(bucketKey, {
        buyVol: isBuy ? usdValue : 0,
        sellVol: isBuy ? 0 : usdValue,
        timestamp: bucketKey,
      });
    }

    const cutoff = Math.floor(Date.now() / 1000) - VOLUME_WINDOW;
    for (const [key] of bucketsRef.current) {
      if (key < cutoff) bucketsRef.current.delete(key);
    }

    tradeCountRef.current.push(time);

    if (usdValue >= ALERT_THRESHOLD) {
      largeAlertsRef.current = [trade, ...largeAlertsRef.current].slice(0, 5);
    }
  }, []);

  // ── WebSocket connection — multi-exchange ─────────────────────────────────

  const connect = useCallback((symbol: typeof SYMBOLS[number]) => {
    // Cleanup previous
    wsRefs.current.forEach(ws => { try { ws.close(); } catch {} });
    wsRefs.current = [];
    connectedCountRef.current = 0;
    setConnected(false);

    tradesRef.current = [];
    bucketsRef.current = new Map();
    tradeCountRef.current = [];
    largeAlertsRef.current = [];
    tradeIdRef.current = 0;

    for (const exchange of EXCHANGES) {
      if (!enabledExchanges.has(exchange.name)) continue;
      const pair = exchange.pairMap[symbol.value];
      if (!pair) continue;

      try {
        const url = exchange.getUrl(pair);
        const ws = new WebSocket(url);

        ws.onopen = () => {
          connectedCountRef.current++;
          setConnected(true);
          if (exchange.getSubscribeMsg) {
            ws.send(exchange.getSubscribeMsg(pair));
          }
        };

        ws.onclose = () => {
          connectedCountRef.current = Math.max(0, connectedCountRef.current - 1);
          if (connectedCountRef.current === 0) setConnected(false);
        };

        ws.onerror = () => {};

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const parsed = exchange.parseTrade(msg);
            if (parsed) {
              processTrade(parsed.price, parsed.qty, parsed.isBuy, parsed.time, exchange.name, exchange.color);
            }
          } catch {}
        };

        wsRefs.current.push(ws);
      } catch {}
    }
  }, [enabledExchanges, processTrade]);

  // ── UI Ticker (10fps) ─────────────────────────────────────────────────────

  useEffect(() => {
    tickerRef.current = setInterval(() => {
      const trades = tradesRef.current;
      const now = Date.now();

      // Update displayed trades
      setDisplayTrades([...trades]);

      // Current price
      if (trades.length > 0) {
        setCurrentPrice(trades[0].price);
      }

      // Compute stats
      const cutoff10s = now - 10_000;
      const cutoff60s = now - 60_000;

      // Prune trade count
      tradeCountRef.current = tradeCountRef.current.filter(t => t > cutoff10s);
      const tradesPerSec = tradeCountRef.current.length / 10;

      // 60s volume from buckets
      let buyVolume60s = 0;
      let sellVolume60s = 0;
      const bucketCutoff = Math.floor(now / 1000) - VOLUME_WINDOW;
      for (const [key, bucket] of bucketsRef.current) {
        if (key >= bucketCutoff) {
          buyVolume60s += bucket.buyVol;
          sellVolume60s += bucket.sellVol;
        }
      }

      // Recent trades for largest + avg
      const recent60 = trades.filter(t => t.time > cutoff60s);
      const largestTrade = recent60.reduce<Trade | null>((max, t) =>
        !max || t.usdValue > max.usdValue ? t : max, null);
      const avgTradeSize = recent60.length > 0
        ? recent60.reduce((s, t) => s + t.usdValue, 0) / recent60.length
        : 0;

      setDisplayStats({
        tradesPerSec,
        buyVolume60s,
        sellVolume60s,
        largestTrade,
        avgTradeSize,
        largeAlerts: [...largeAlertsRef.current],
      });

      // Volume buckets for chart
      const nowSec = Math.floor(now / 1000);
      const buckets: VolumeBucket[] = [];
      for (let i = VOLUME_WINDOW - 1; i >= 0; i--) {
        const key = nowSec - i;
        const b = bucketsRef.current.get(key);
        buckets.push(b || { buyVol: 0, sellVol: 0, timestamp: key });
      }
      setDisplayBuckets(buckets);

      // Volume delta
      setDisplayDelta(buyVolume60s - sellVolume60s);
    }, UI_INTERVAL);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // ── Connect on mount / symbol change ───────────────────────────────────────

  useEffect(() => {
    connect(selectedSymbol);
    return () => {
      wsRefs.current.forEach(ws => { try { ws.close(); } catch {} });
      wsRefs.current = [];
    };
  }, [selectedSymbol, connect]);

  // ── Symbol change handler ──────────────────────────────────────────────────

  const handleSymbolChange = (sym: typeof SYMBOLS[number]) => {
    setSelectedSymbol(sym);
    setDropdownOpen(false);
    setDisplayTrades([]);
    setCurrentPrice(0);
  };

  // ── Volume chart ───────────────────────────────────────────────────────────

  const maxBucketVol = Math.max(
    1,
    ...displayBuckets.map(b => Math.max(b.buyVol, b.sellVol))
  );

  const totalVolume = displayStats.buyVolume60s + displayStats.sellVolume60s;
  const buyRatio = totalVolume > 0 ? (displayStats.buyVolume60s / totalVolume) * 100 : 50;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen -mt-8 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4">
      <BackButton />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-btc-orange" />
          <h1 className="text-lg font-mono font-bold tracking-widest uppercase text-white">
            Trade Flow
          </h1>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <Wifi size={12} className="text-emerald-500" />
              <span className="text-[9px] font-mono uppercase text-emerald-500">Live</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
              <WifiOff size={12} className="text-red-500" />
              <span className="text-[9px] font-mono uppercase text-red-500">Disconnected</span>
            </>
          )}
        </div>

        {/* Symbol selector */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-btc-orange/20 text-xs font-mono text-btc-orange hover:bg-white/10 transition-colors"
          >
            {selectedSymbol.label}
            <ChevronDown size={12} className={cn('transition-transform', dropdownOpen && 'rotate-180')} />
          </button>
          {dropdownOpen && (
            <div className="absolute top-full mt-1 left-0 z-50 bg-[#111] border border-btc-orange/20 shadow-xl min-w-[140px]">
              {SYMBOLS.map((sym) => (
                <button
                  key={sym.value}
                  onClick={() => handleSymbolChange(sym)}
                  className={cn(
                    'block w-full text-left px-3 py-2 text-xs font-mono hover:bg-btc-orange/10 transition-colors',
                    sym.value === selectedSymbol.value ? 'text-btc-orange' : 'text-gray-400'
                  )}
                >
                  {sym.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Exchange toggles */}
        <div className="flex items-center gap-1">
          {EXCHANGES.map(ex => {
            const active = enabledExchanges.has(ex.name);
            return (
              <button
                key={ex.name}
                onClick={() => toggleExchange(ex.name)}
                className={cn(
                  'px-2 py-1 text-[9px] font-mono uppercase tracking-wider border transition-colors',
                  active
                    ? 'border-white/20 text-white'
                    : 'border-white/5 text-gray-700 hover:text-gray-500'
                )}
                style={active ? { borderColor: `${ex.color}40`, backgroundColor: `${ex.color}10`, color: ex.color } : {}}
              >
                {ex.name}
              </button>
            );
          })}
        </div>

        {/* Pause/Resume */}
        <button
          onClick={() => setPaused(!paused)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors border',
            paused
              ? 'bg-btc-orange/10 border-btc-orange/30 text-btc-orange'
              : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
          )}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Main grid */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Trade Tape */}
        <div className="lg:w-2/3 bg-[#0d0d0d] border border-white/5 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 260px)' }}>
          {/* Tape header */}
          <div className="flex items-center px-3 py-1.5 bg-white/[0.02] border-b border-white/5 text-[9px] font-mono uppercase tracking-widest text-gray-500">
            <span className="w-[100px]">Time</span>
            <span className="w-[110px] text-right">Price</span>
            <span className="w-[90px] text-right">Size</span>
            <span className="w-[90px] text-right">Value</span>
            <span className="w-[50px] text-center">Side</span>
            <span className="w-[70px] text-center">Source</span>
          </div>

          {/* Trade rows */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
            {displayTrades.map((trade) => {
              const isLarge = trade.usdValue >= LARGE_TRADE_THRESHOLD;
              return (
                <div
                  key={trade.id}
                  className={cn(
                    'flex items-center px-3 py-[3px] font-mono text-[11px] border-b border-white/[0.02] transition-colors duration-200',
                    trade.isBuy
                      ? isLarge ? 'bg-emerald-500/15' : 'bg-emerald-500/[0.04]'
                      : isLarge ? 'bg-red-500/15' : 'bg-red-500/[0.04]',
                    isLarge && 'shadow-[inset_0_0_20px_rgba(247,147,26,0.08)]'
                  )}
                >
                  <span className="w-[100px] text-gray-500 tabular-nums">
                    {formatTime(trade.time)}
                  </span>
                  <span className={cn(
                    'w-[110px] text-right tabular-nums font-medium',
                    trade.isBuy ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {formatNumber(trade.price, selectedSymbol.decimals)}
                  </span>
                  <span className="w-[90px] text-right tabular-nums text-gray-300">
                    {formatQty(trade.qty)}
                  </span>
                  <span className={cn(
                    'w-[90px] text-right tabular-nums',
                    isLarge ? 'text-btc-orange font-bold' : 'text-gray-400'
                  )}>
                    {formatUsd(trade.usdValue)}
                  </span>
                  <span className={cn(
                    'w-[50px] text-center text-[9px] uppercase font-bold tracking-wider',
                    trade.isBuy ? 'text-emerald-500' : 'text-red-500'
                  )}>
                    {trade.isBuy ? 'BUY' : 'SELL'}
                  </span>
                  <span className="w-[70px] text-center text-[8px] font-mono uppercase tracking-wider" style={{ color: trade.exchangeColor }}>
                    {trade.exchange}
                  </span>
                  {isLarge && (
                    <span className="ml-1 text-[8px] text-btc-orange animate-pulse">&#9679;</span>
                  )}
                </div>
              );
            })}
            {displayTrades.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
                {connected ? 'Waiting for trades...' : 'Connecting...'}
              </div>
            )}
          </div>
        </div>

        {/* Stats Panel */}
        <div className="lg:w-1/3 flex flex-col gap-3">
          {/* Price */}
          <div className="bg-[#0d0d0d] border border-white/5 p-4">
            <div className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-1">
              {selectedSymbol.label}
            </div>
            <div className="text-2xl font-mono font-bold text-white tabular-nums">
              ${formatNumber(currentPrice, selectedSymbol.decimals)}
            </div>
          </div>

          {/* Volume Bars */}
          <div className="bg-[#0d0d0d] border border-white/5 p-4">
            <div className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">
              Volume (60s)
            </div>
            <svg viewBox={`0 0 ${VOLUME_WINDOW * 5} 80`} className="w-full h-20" preserveAspectRatio="none">
              {displayBuckets.map((bucket, i) => {
                const buyH = maxBucketVol > 0 ? (bucket.buyVol / maxBucketVol) * 38 : 0;
                const sellH = maxBucketVol > 0 ? (bucket.sellVol / maxBucketVol) * 38 : 0;
                return (
                  <g key={i}>
                    {/* Buy bar (goes up from center) */}
                    <rect
                      x={i * 5}
                      y={40 - buyH}
                      width={4}
                      height={buyH}
                      fill="#10b981"
                      opacity={0.8}
                    />
                    {/* Sell bar (goes down from center) */}
                    <rect
                      x={i * 5}
                      y={40}
                      width={4}
                      height={sellH}
                      fill="#ef4444"
                      opacity={0.8}
                    />
                  </g>
                );
              })}
              {/* Center line */}
              <line x1="0" y1="40" x2={VOLUME_WINDOW * 5} y2="40" stroke="#333" strokeWidth="0.5" />
            </svg>
            <div className="text-[10px] font-mono text-gray-500 mt-1 tabular-nums">
              Total: {formatUsd(totalVolume)}
            </div>
          </div>

          {/* Trade Stats */}
          <div className="bg-[#0d0d0d] border border-white/5 p-4 space-y-3">
            <div className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">
              Trade Stats
            </div>

            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-gray-500">Trades/sec</span>
              <span className="text-white tabular-nums">{displayStats.tradesPerSec.toFixed(1)}</span>
            </div>

            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-emerald-500">Buy Vol (60s)</span>
              <span className="text-emerald-400 tabular-nums">{formatUsd(displayStats.buyVolume60s)}</span>
            </div>

            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-red-500">Sell Vol (60s)</span>
              <span className="text-red-400 tabular-nums">{formatUsd(displayStats.sellVolume60s)}</span>
            </div>

            {/* Buy/Sell ratio bar */}
            <div>
              <div className="text-[9px] font-mono text-gray-500 mb-1">Buy/Sell Ratio</div>
              <div className="flex h-3 w-full overflow-hidden bg-[#1a1a1a]">
                <div
                  className="bg-emerald-500/70 transition-all duration-300"
                  style={{ width: `${buyRatio}%` }}
                />
                <div
                  className="bg-red-500/70 transition-all duration-300"
                  style={{ width: `${100 - buyRatio}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono mt-0.5">
                <span className="text-emerald-500">{buyRatio.toFixed(1)}%</span>
                <span className="text-red-500">{(100 - buyRatio).toFixed(1)}%</span>
              </div>
            </div>

            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-gray-500">Avg Trade</span>
              <span className="text-white tabular-nums">{formatUsd(displayStats.avgTradeSize)}</span>
            </div>

            {displayStats.largestTrade && (
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-btc-orange">Largest (60s)</span>
                <span className={cn(
                  'tabular-nums',
                  displayStats.largestTrade.isBuy ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {formatUsd(displayStats.largestTrade.usdValue)}
                  {' '}
                  <span className="text-[9px]">{displayStats.largestTrade.isBuy ? 'BUY' : 'SELL'}</span>
                </span>
              </div>
            )}
          </div>

          {/* Large Trade Alerts */}
          <div className="bg-[#0d0d0d] border border-white/5 p-4">
            <div className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">
              Large Trades (&gt;$100K)
            </div>
            {displayStats.largeAlerts.length === 0 ? (
              <div className="text-[10px] font-mono text-gray-600 italic">
                No large trades yet
              </div>
            ) : (
              <div className="space-y-1.5">
                {displayStats.largeAlerts.map((t, i) => (
                  <div
                    key={t.id}
                    className={cn(
                      'flex items-center justify-between text-[10px] font-mono px-2 py-1.5 border',
                      t.isBuy
                        ? 'bg-emerald-500/10 border-emerald-500/20'
                        : 'bg-red-500/10 border-red-500/20',
                      i === 0 && 'animate-pulse'
                    )}
                  >
                    <span className="text-gray-500 tabular-nums">{formatTime(t.time)}</span>
                    <span className={cn('font-bold tabular-nums', t.isBuy ? 'text-emerald-400' : 'text-red-400')}>
                      {formatUsd(t.usdValue)}
                    </span>
                    <span className={cn('text-[8px] uppercase font-bold', t.isBuy ? 'text-emerald-500' : 'text-red-500')}>
                      {t.isBuy ? 'BUY' : 'SELL'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Volume Delta Bar */}
      <div className="mt-3 bg-[#0d0d0d] border border-white/5 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">
            Cumulative Volume Delta (60s)
          </span>
          <span className={cn(
            'text-[11px] font-mono font-bold tabular-nums',
            displayDelta >= 0 ? 'text-emerald-400' : 'text-red-400'
          )}>
            {displayDelta >= 0 ? '+' : ''}{formatUsd(displayDelta)}
          </span>
        </div>
        <div className="relative h-4 bg-[#1a1a1a] w-full overflow-hidden">
          {/* Center marker */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600 z-10" />
          {(() => {
            const maxDelta = Math.max(Math.abs(displayDelta), 1);
            const barWidth = Math.min((Math.abs(displayDelta) / (maxDelta * 2)) * 100, 50);
            if (displayDelta >= 0) {
              return (
                <div
                  className="absolute top-0 bottom-0 bg-emerald-500/60 transition-all duration-300"
                  style={{ left: '50%', width: `${barWidth}%` }}
                />
              );
            } else {
              return (
                <div
                  className="absolute top-0 bottom-0 bg-red-500/60 transition-all duration-300"
                  style={{ right: '50%', width: `${barWidth}%` }}
                />
              );
            }
          })()}
        </div>
      </div>
    </div>
  );
};
