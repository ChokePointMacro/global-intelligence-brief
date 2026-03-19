import { generateReportWithFallback, parseJSONResponse } from "./aiService";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Headline {
  title: string;
  summary: string;
  url: string;
  alternateUrl?: string;
  category: string;
  socialPost: string;
  sentiment?: string;
  confidence?: number;
  trendScore?: number;
}

export interface Analysis {
  performanceRanking: string;
  verificationScore: number | string;
  integrityScore: number | string;
  overallSummary: string;
  globalSocialPost: string;
}

export interface WeeklyReport {
  headlines: Headline[];
  analysis: Analysis;
}

export interface ForecastEvent {
  rank: number;
  title: string;
  expectedDate: string;
  summary: string;
  probability: number;
  effectIfHappens: string;
  effectIfDoesntHappen: string;
  markets: string[];
  industries: string[];
  countries: string[];
  category: string;
  sentiment: string;
  url: string;
  alternateUrl?: string;
}

export interface ForecastAnalysis {
  dominantTheme: string;
  highestImpactEvent: string;
  overallRiskLevel: string;
  watchlist: string;
  globalSocialPost: string;
}

export interface ForecastReport {
  events: ForecastEvent[];
  analysis: ForecastAnalysis;
}

// ── Real-time news fetcher ─────────────────────────────────────────────────────

const RSS_SOURCES: Record<string, string[]> = {
  global: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://rss.cnn.com/rss/edition_world.rss",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://feeds.npr.org/1004/rss.xml",           // NPR World
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
  ],
  crypto: [
    "https://cointelegraph.com/rss",
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://decrypt.co/feed",
    "https://bitcoinmagazine.com/.rss/full/",
  ],
  equities: [
    "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://feeds.npr.org/1006/rss.xml",           // NPR Business
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
  ],
  nasdaq: [
    "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.npr.org/1006/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
  ],
  conspiracies: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://rss.cnn.com/rss/edition_world.rss",
    "https://feeds.npr.org/1004/rss.xml",
  ],
  china: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://www.scmp.com/rss/91/feed",             // South China Morning Post
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
  ],
};

interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface SourceStatus {
  name: string;
  url: string;
  status: 'ok' | 'error' | 'timeout' | 'filtered';
  articles?: number;
}

export type ProgressCallback = (stage: string, percent: number, sources?: SourceStatus[]) => void;

async function fetchRSSFeed(url: string): Promise<{ items: NewsItem[]; status: SourceStatus }> {
  const sourceName = new URL(url).hostname.replace(/^www\./, '').replace(/^feeds\./, '');
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsFetcher/1.0)" },
    });
    if (!res.ok) return { items: [], status: { name: sourceName, url, status: 'error', articles: 0 } };
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g);
    for (const match of itemMatches) {
      const block = match[1];
      const title       = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title[^>]*>(.*?)<\/title>/))?.[1]?.trim() || '';
      const description = (block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description[^>]*>(.*?)<\/description>/))?.[1]?.trim() || '';
      const link        = (block.match(/<link[^>]*>(.*?)<\/link>/) || block.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || '';
      const pubDate     = (block.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';
      if (title) items.push({ title, description: description.replace(/<[^>]+>/g, '').slice(0, 300), link, pubDate, source: sourceName });
    }
    return { items, status: { name: sourceName, url, status: items.length ? 'ok' : 'error', articles: items.length } };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'));
    return { items: [], status: { name: sourceName, url, status: isTimeout ? 'timeout' : 'error', articles: 0 } };
  }
}

// ── Quality filtering ─────────────────────────────────────────────────────────

// +25 — wire services & papers of record
const TIER1_SOURCES = new Set([
  'reuters.com', 'apnews.com', 'bbc.co.uk', 'bbci.co.uk', 'nytimes.com',
  'wsj.com', 'ft.com', 'bloomberg.com', 'economist.com', 'aljazeera.com',
  'dowjones.io', 'scmp.com', 'theguardian.com',
]);

// +20 — high-engagement X/Twitter posts (matched by source tag)
const TIER_X_SOURCES = new Set([
  'x.com', 'twitter.com', 'nitter.net',
]);

// +15 — strong specialist outlets
const TIER2_SOURCES = new Set([
  'npr.org', 'politico.com', 'cnbc.com',
  'coindesk.com', 'cointelegraph.com', 'decrypt.co', 'bitcoinmagazine.com',
  'theverge.com', 'zerohedge.com', 'semafor.com',
  'tradingview.com', 'marketwatch.com', 'seekingalpha.com', 'fred.stlouisfed.org',
]);

// +10 — solid editorial sources
const TIER3_SOURCES = new Set([
  'foxnews.com', 'foxbusiness.com',      // Fox
  'axios.com',                             // Axios — concise breaking news
  'theblock.co',                           // The Block — crypto/fintech
  'defensenews.com',                       // Defense News — military/geopolitical
  'oilprice.com',                          // OilPrice — energy/commodities
  'foreignaffairs.com',                    // Foreign Affairs — geopolitical analysis
]);

const CLICKBAIT_PATTERNS = [
  /^[0-9]+ (things|reasons|ways|tips|facts)/i,
  /you won'?t believe/i,
  /what happens next/i,
  /this is (why|how|what)/i,
  /^\s*watch:/i,
  /^\s*live:/i,
  /^\s*photos?:/i,
  /^\s*video:/i,
  /^\s*quiz:/i,
  /^\s*opinion:/i,
  /^\s*review:/i,
];

function scoreArticle(item: NewsItem): number {
  let score = 50; // baseline

  // Source tier
  const host = item.source.toLowerCase();
  if ([...TIER1_SOURCES].some(s => host.includes(s.replace(/\..*/, '')))) score += 25;
  else if ([...TIER_X_SOURCES].some(s => host.includes(s.replace(/\..*/, '')))) score += 20;
  else if ([...TIER2_SOURCES].some(s => host.includes(s.replace(/\..*/, '')))) score += 15;
  else if ([...TIER3_SOURCES].some(s => host.includes(s.replace(/\..*/, '')))) score += 10;

  // Has description (real articles have summaries)
  if (item.description && item.description.length > 50) score += 15;
  else if (!item.description || item.description.length < 10) score -= 20;

  // Title quality
  if (item.title.length < 15) score -= 25; // too short = filler
  if (item.title.length > 30 && item.title.length < 120) score += 5; // good length
  if (CLICKBAIT_PATTERNS.some(p => p.test(item.title))) score -= 30;

  // Recency boost
  if (item.pubDate) {
    const age = Date.now() - new Date(item.pubDate).getTime();
    if (age < 48 * 60 * 60 * 1000) score += 15;      // last 48h
    else if (age < 96 * 60 * 60 * 1000) score += 5;   // last 4 days
  }

  return score;
}

async function fetchNewsContext(type: string, windowDays: number): Promise<{ text: string; sources: SourceStatus[] }> {
  const sourceUrls = RSS_SOURCES[type] ?? RSS_SOURCES.global;
  const cutoff  = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const results = await Promise.all(sourceUrls.map(fetchRSSFeed));
  const sourceStatuses = results.map(r => r.status);
  const allItems = results.flatMap(r => r.items);

  // Filter to window, deduplicate, score, and take top 40
  const filtered = allItems
    .filter(item => {
      if (!item.pubDate) return true;
      const d = new Date(item.pubDate);
      return !isNaN(d.getTime()) && d.getTime() >= cutoff;
    })
    .filter((item, idx, arr) => arr.findIndex(x => x.title.slice(0, 40) === item.title.slice(0, 40)) === idx)
    .map(item => ({ item, score: scoreArticle(item) }))
    .filter(({ score }) => score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(({ item }) => item);

  if (!filtered.length) return { text: '[No live RSS articles fetched — model must rely on recent verified knowledge only]', sources: sourceStatuses };

  const lines = filtered.map((item, i) =>
    `[${i + 1}] ${item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?'} | ${item.source} | ${item.title}${item.description ? ` — ${item.description.slice(0, 150)}` : ''} | ${item.link}`
  ).join('\n');

  return { text: `--- LIVE NEWS FEED (fetched right now, ${filtered.length} articles) ---\n${lines}\n--- END LIVE FEED ---`, sources: sourceStatuses };
}

// ── Reddit + StockTwits fetchers (for speculation report) ─────────────────────

const REDDIT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SPECULATION_SUBREDDITS = [
  // Financial speculation & rumours
  "wallstreetbets", "stocks", "investing", "StockMarket", "options", "SecurityAnalysis",
  // M&A / private equity rumours
  "mergers", "ValueInvesting", "business",
  // Crypto speculation
  "CryptoCurrency", "Bitcoin", "CryptoMoonShots",
  // Macro / geopolitics
  "geopolitics", "worldnews", "Economics", "Forex",
  // Tech leaks / product rumours
  "apple", "nvidia", "hardware", "technology",
];

interface RedditPost {
  subreddit: string;
  title: string;
  text: string;
  url: string;
  permalink: string;
  score: number;
  numComments: number;
  upvoteRatio: number;
  flair: string;
  created: number;
}

async function fetchSubreddit(sub: string, windowMs: number): Promise<RedditPost[]> {
  try {
    const r = await fetch(
      `https://www.reddit.com/r/${sub}/hot.json?limit=25`,
      { signal: AbortSignal.timeout(5000), headers: { "User-Agent": REDDIT_UA } }
    );
    if (!r.ok) return [];
    const data = await r.json() as any;
    const cutoff = Date.now() - windowMs;
    return (data.data?.children || [])
      .map((c: any) => c.data)
      .filter((p: any) => p.created_utc * 1000 >= cutoff && p.score > 100 && p.num_comments > 5)
      .map((p: any) => ({
        subreddit: p.subreddit,
        title:     p.title,
        text:      (p.selftext || '').replace(/\n+/g, ' ').slice(0, 350),
        url:       p.url,
        permalink: `https://reddit.com${p.permalink}`,
        score:     p.score,
        numComments: p.num_comments,
        upvoteRatio: p.upvote_ratio,
        flair:     p.link_flair_text || '',
        created:   p.created_utc * 1000,
      }));
  } catch { return []; }
}

async function fetchStockTwits(): Promise<string> {
  try {
    const r = await fetch(
      "https://api.stocktwits.com/api/2/streams/trending.json",
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) return '';
    const data = await r.json() as any;
    const msgs: string[] = (data.messages || [])
      .slice(0, 20)
      .map((m: any) => {
        const sym = m.symbols?.map((s: any) => `$${s.symbol}`).join(' ') || '';
        const sent = m.entities?.sentiment?.basic || '';
        return `${sym}${sent ? ` [${sent}]` : ''}: ${(m.body || '').slice(0, 120)}`;
      });
    return msgs.length ? `--- STOCKTWITS TRENDING (${msgs.length} posts) ---\n${msgs.join('\n')}` : '';
  } catch { return ''; }
}

async function fetchSpeculationContext(windowDays: number): Promise<string> {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  // Fetch all subreddits + StockTwits in parallel
  const [redditResults, stTwits] = await Promise.all([
    Promise.all(SPECULATION_SUBREDDITS.map(s => fetchSubreddit(s, windowMs))),
    fetchStockTwits(),
  ]);
  const allPosts = redditResults.flat();

  // Sort by score desc, deduplicate by title prefix, cap at 40
  const seen = new Set<string>();
  const top = allPosts
    .sort((a, b) => b.score - a.score)
    .filter(p => {
      const key = p.title.slice(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);

  if (!top.length && !stTwits) return '[No speculation data fetched]';

  const redditLines = top.map((p, i) => {
    const date = new Date(p.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `[${i + 1}] r/${p.subreddit}${p.flair ? ` [${p.flair}]` : ''} | ${date} | ↑${p.score} | ${p.title}${p.text ? ` — ${p.text.slice(0, 200)}` : ''} | ${p.permalink}`;
  }).join('\n');

  return `--- REDDIT LIVE FEED (${top.length} posts, sorted by upvotes) ---\n${redditLines}\n\n${stTwits}`;
}

// ── Constants & shared helpers ────────────────────────────────────────────────

const INSTAGRAM_MAX_CHARS = 2100;

function formatCurrentDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateOffset(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function truncateToInstagram(text: string): string {
  return text.length > INSTAGRAM_MAX_CHARS
    ? text.slice(0, INSTAGRAM_MAX_CHARS - 3) + "..."
    : text;
}

// ── Report type configuration ─────────────────────────────────────────────────

interface ReportConfig {
  topicFocus: string;
  reportTitle: string;
  timeframe: string;
  timeframeDescriptor: string;
  sentimentVocab: string;
  maxTokens: number;
  isConspiracy?: boolean;
}

const REPORT_CONFIGS: Record<string, ReportConfig> = {
  global: {
    topicFocus: "Global macro shifts, geopolitical events, and major economic trends",
    reportTitle: "Global Pulse",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "escalating | stable | de-escalating",
    maxTokens: 8000,
  },
  crypto: {
    topicFocus: "Cryptocurrency industry ONLY. Focus on Bitcoin, Ethereum, Altcoins, DeFi, Blockchain technology, NFTs, GameFi, Crypto regulation, exchange developments, and significant Web3 industry events. Omit non-crypto news.",
    reportTitle: "Crypto Industry Pulse",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    maxTokens: 8000,
  },
  equities: {
    topicFocus: "S&P 500 Equities ONLY. Focus on the top 500 US stocks, significant news, earnings results, and price movements for companies within the S&P 500. Omit all other macro news, geopolitics, or non-S&P 500 stocks.",
    reportTitle: "S&P 500 Momentum Report",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    maxTokens: 8000,
  },
  nasdaq: {
    topicFocus: "Nasdaq-100 tech and growth stocks ONLY. Focus on AAPL, NVDA, MSFT, META, AMZN, GOOGL, TSLA and other Nasdaq-100 constituents. Emphasise: AI/product announcements, earnings beats/misses, analyst upgrades/downgrades, rate-sensitive growth stock moves, and sector-wide tech themes. Omit S&P 500 non-tech names and macro news unless it directly moves Nasdaq prices.",
    reportTitle: "Nasdaq-100 Tech Pulse",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    maxTokens: 8000,
  },
  conspiracies: {
    topicFocus: "Widely viral, unverified or actively contested claims circulating on X (Twitter), TikTok, Facebook, Reddit, and Google. Focus on topics that are heavily discussed in mainstream social media but lack confirmation from established news sources — stories that are disputed, fact-checked as false, or still under investigation. Include historical context from the last 20 years where relevant, but prioritize what is trending in the last 30 days.",
    reportTitle: "The Conspiracy Pulse",
    timeframe: "last 30 days (with 20-year historical context)",
    timeframeDescriptor: "from the last 30 days",
    sentimentVocab: "viral | fading | debunked",
    maxTokens: 9000,
    isConspiracy: true,
  },
  china: {
    topicFocus: `Chinese influence, control, and leverage points in global supply chains — focusing on hidden dependencies that most market participants underestimate. Coverage must span: (1) Critical Minerals & Rare Earths — gallium, germanium, graphite, cobalt, NdFeB magnets and export control developments; (2) Agricultural Inputs — phosphate, fertilizer, potash supply chokepoints; (3) Pharmaceuticals — API/active pharmaceutical ingredient dependencies, heparin, generic drug supply; (4) Semiconductors & Electronics — PCB manufacturing, advanced packaging, ZPMC port cranes; (5) EV & Battery — CATL, LFP chemistry, graphite anode, lithium refining; (6) Maritime & Shipping — Chinese shipbuilding dominance, COSCO fleet movements, port infrastructure; (7) Military & Dual-Use — PLA modernization, Volt Typhoon/Salt Typhoon infrastructure access, technology transfer; (8) Trade Policy — US-China tariff escalation (Trump 2.0 145%), decoupling vs engagement debate, friend-shoring progress; (9) Foreign Investment — BRI project updates, Chinese FDI into critical resource nations, Western divestment pressures; (10) Risk Events — Taiwan strait tensions, export ban escalation, sanctions, commodity market manipulation. Emphasise non-obvious, high-consequence dependencies that cascade across industries if disrupted. Include investment and risk implications for each item.`,
    reportTitle: "China Supply Chain Intelligence",
    timeframe: "last 90 days with 30-day forward outlook",
    timeframeDescriptor: "from the last 90 days, with forward-looking risk and opportunity analysis for the next 30 days",
    sentimentVocab: "critical | escalating | opportunity | bullish | bearish | risk-off | stable | de-escalating",
    maxTokens: 10000,
  },
};

// ── Speculation report ────────────────────────────────────────────────────────

export async function generateSpeculationReport(onProgress?: ProgressCallback): Promise<WeeklyReport & { _sources?: SourceStatus[]; _warnings?: string[] }> {
  const currentDate = formatCurrentDate();
  const windowDays  = 7;
  const windowStart = formatDateOffset(windowDays);

  onProgress?.('Fetching Reddit & StockTwits...', 10);
  console.log('[generateSpeculationReport] Fetching Reddit + StockTwits...');
  const liveContext = await fetchSpeculationContext(windowDays);
  const specSources: SourceStatus[] = [
    { name: 'Reddit', url: 'reddit.com', status: liveContext.includes('REDDIT LIVE FEED') ? 'ok' : 'error', articles: (liveContext.match(/\[\d+\]/g) || []).length },
    { name: 'StockTwits', url: 'stocktwits.com', status: liveContext.includes('STOCKTWITS TRENDING') ? 'ok' : 'error' },
  ];
  onProgress?.('Filtering speculation data...', 25, specSources);

  const prompt = `You are an intelligence analyst specialising in market rumours, leaked information, and crowd-sourced speculation. Today is ${currentDate}.

CRITICAL — DATA SOURCE RULES:
1. Use ONLY the Reddit posts and StockTwits data provided below. Do NOT use training data knowledge.
2. Only include posts dated between ${windowStart} and ${currentDate}. Ignore older posts.
3. Every headline must be grounded in a real post from the feed. URL must be the Reddit permalink or a source linked in the post.
4. If a category has no matching posts, skip it rather than inventing content.

${liveContext}

TASK: From the posts above, extract exactly 20 of the highest-signal speculation items covering: merger/acquisition rumours, product leaks, earnings surprises, geopolitical speculation, currency moves, crypto catalysts, and notable viral business narratives.

PRIORITY RANKING — weight by:
1. Upvote score × comment count (community conviction)
2. Presence of specific ticker symbols, company names, or dates (actionability)
3. Cross-subreddit confirmation (same rumour appearing in multiple subs = higher weight)
4. Recency (last 48h scores highest)

HEADLINE FIELDS (repeat for all 20):
- title: factual headline ≤20 words describing the speculation/rumour/leak
- trendScore: integer 1–100 based on upvotes, comments, and cross-sub confirmation
- summary: 150–200 words. What is being speculated/rumoured? Who are the key actors? What evidence or signals exist? What's the bull/bear case? Be specific — include tickers, prices, and dates where present in the source.
- url: Reddit permalink or linked source URL from the post
- alternateUrl: second source if available, otherwise leave as the same permalink
- category: one of: merger-rumour | product-leak | earnings-speculation | geopolitical | currency | crypto | macro | corporate
- socialPost: ≤280 character tweet written in the voice of a sharp market observer. Include relevant $TICKER if present. Do not copy the first sentence of summary.
- sentiment: exactly one word from: bullish | bearish | neutral | speculative | leaked | viral

ANALYSIS SECTION:
- performanceRanking: top 3 speculations ranked by potential market impact, one sentence each
- verificationScore: integer 1–100 (how sourced/corroborated is the overall set)
- integrityScore: integer 1–100 (signal-to-noise ratio of this batch)
- overallSummary: 100–150 words — what is the dominant speculative theme this week? What are the highest-conviction rumours? What should a trader be watching?
- globalSocialPost: ≤280 character summary tweet of the speculation landscape this week

OUTPUT RULES:
1. Return ONLY valid JSON — no markdown, no code blocks.
2. All 20 headlines must have summary and sentiment.
3. Sort headlines array by trendScore descending.`;

  onProgress?.('Sending to AI provider...', 35, specSources);
  console.log('[generateSpeculationReport] Calling AI...');
  const aiResponse = await generateReportWithFallback(prompt, ['claude', 'gpt'], 9000);
  onProgress?.('Parsing AI response...', 85, specSources);
  const parsed = parseJSONResponse<WeeklyReport>(aiResponse);
  const warnings: string[] = [...(aiResponse.warnings || [])];

  if (!parsed.headlines?.length) throw new Error('No headlines in speculation response');
  if (parsed.headlines.length < 20) warnings.push(`Only ${parsed.headlines.length}/20 speculation items generated.`);
  if (!parsed.analysis) {
    parsed.analysis = {
      performanceRanking: 'Top speculation items ranked by community conviction',
      verificationScore: 45,
      integrityScore: 60,
      overallSummary: `${parsed.headlines.length} speculation items sourced from Reddit and StockTwits.`,
      globalSocialPost: `Speculation Pulse: ${parsed.headlines[0]?.title}`,
    };
    warnings.push('Analysis section was missing — synthesized from headlines.');
  }
  parsed.headlines.sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));
  onProgress?.('Complete', 100, specSources);
  console.log(`[generateSpeculationReport] ✓ ${parsed.headlines.length} items`);
  return { ...parsed, _sources: specSources, _warnings: warnings.length ? warnings : undefined };
}

function getTrendingWeightInstructions(type: string): string {
  switch (type) {
    case 'global':
      return `\nTRENDING WEIGHT SYSTEM — rank all 20 headlines by combined score of:\n  - Recency (40%): events from last 24–72 hours score highest\n  - Social Traction (30%): volume of coverage across X/Twitter, Google Trends, Reddit, and mainstream media\n  - Strategic Impact (30%): geopolitical, economic, or military significance\nSort headlines with highest trendScore first. Assign each headline a trendScore (1–100).`;
    case 'crypto':
      return `\nTRENDING WEIGHT SYSTEM — rank all 20 headlines by:\n  - Price Impact (40%): headlines that moved BTC/ETH or altcoins ≥2%\n  - Social Traction (35%): trending on crypto Twitter, Reddit r/CryptoCurrency, Discord\n  - Regulatory Weight (25%): government actions, exchange rulings, legal developments\nSort highest trendScore first. Assign each headline a trendScore (1–100).`;
    case 'equities':
      return `\nTRENDING WEIGHT SYSTEM — rank all 20 headlines by:\n  - Market Impact (40%): % move in stock or sector ETF\n  - Earnings/Guidance (35%): beats, misses, forward guidance revisions\n  - Analyst Coverage (25%): upgrades, downgrades, price target changes\nSort highest trendScore first. Assign each headline a trendScore (1–100).`;
    case 'nasdaq':
      return `\nTRENDING WEIGHT SYSTEM — rank all 20 headlines by:\n  - Price/Volatility Impact (40%): % move in individual Nasdaq-100 stock or QQQ ETF\n  - Earnings & Product News (35%): earnings beats/misses, AI announcements, product launches, guidance changes\n  - Analyst & Institutional Activity (25%): upgrades, downgrades, price target revisions, large fund moves\nSort highest trendScore first. Assign each headline a trendScore (1–100).`;
    default:
      return `\nTRENDING WEIGHT: Assign each headline a trendScore (1–100) based on recency, social volume, and strategic importance. Sort highest first.`;
  }
}

function validateHeadlines(headlines: Headline[]): void {
  let stubCount = 0;
  for (let i = 0; i < headlines.length; i++) {
    const words = (headlines[i].summary || "").trim().split(/\s+/).filter(w => w.length > 0).length;
    if (words < 20) {
      stubCount++;
      console.warn(`[generateWeeklyReport] ⚠ Stub summary — headline ${i + 1}: ${words} words`);
    }
  }
  if (stubCount === headlines.length) {
    throw new Error("All summaries are empty stubs — provider returned no usable content.");
  }
}

// ── Forecast report ───────────────────────────────────────────────────────────

export async function generateForecastReport(onProgress?: ProgressCallback): Promise<ForecastReport & { _sources?: SourceStatus[]; _warnings?: string[] }> {
  const currentDate = formatCurrentDate();
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  onProgress?.('Fetching news sources...', 10);
  console.log('[generateForecastReport] Fetching live news context...');
  const { text: liveContext, sources: sourceStatuses } = await fetchNewsContext('global', 7);
  onProgress?.('Filtering & scoring articles...', 25, sourceStatuses);

  const prompt = `You are a senior geopolitical risk analyst and macro strategist. Today is ${currentDate}. Your forward planning window is ${currentDate} through ${sevenDaysOut}.

CRITICAL — DATA SOURCE RULES:
1. Use ONLY the live news feed below to identify real upcoming events. Do NOT use training data to fill in events.
2. Every event you list must be grounded in something mentioned or implied in the live feed.
3. URLs must come from the live feed articles. Do not construct or guess URLs.

${liveContext}

TASK: Using the live news above, identify exactly 10 upcoming events, decisions, or catalysts within the next 7 days that carry the highest potential to move financial markets or escalate/de-escalate geopolitical tension. These must be REAL scheduled or anticipated events — central bank decisions, earnings, elections, summits, treaty deadlines, sanctions reviews, military exercises, etc.

For each event, provide a rigorous probabilistic assessment and dual-outcome impact analysis.

RANKING: Sort events by (probability × expected magnitude of impact). Most impactful expected outcome = rank 1.

EVENT FIELDS (repeat for all 10):
- rank: integer 1–10
- title: clear event name ≤15 words — WHAT, WHERE, WHEN
- expectedDate: specific date or date range (e.g. "March 19, 2026" or "March 18–20, 2026")
- summary: 100–130 words. What is this event, who are the key actors, what is at stake, and why does it matter to markets or geopolitical stability right now?
- probability: integer 0–100 representing % chance the event occurs or resolves as described
- effectIfHappens: 60–80 words. Specific market and geopolitical impact if the event occurs as anticipated. Name specific assets, indices, sectors, or countries affected and direction (up/down/escalate/de-escalate).
- effectIfDoesntHappen: 60–80 words. Specific impact if the event fails to materialize, is delayed, or surprises to the downside/upside. Name specific assets, indices, sectors, or countries affected.
- markets: array of 2–5 specific markets or assets affected (e.g. "S&P 500", "WTI Crude", "Gold", "USD/JPY", "10Y Treasury", "BTC", "EUR/USD")
- industries: array of 2–4 industries most exposed (e.g. "Defense", "Energy", "Semiconductor", "Banking", "Pharma")
- countries: array of 2–5 countries or regions most affected (e.g. "USA", "China", "EU", "Russia", "Middle East")
- category: one of: monetary-policy | earnings | geopolitical | elections | trade | energy | regulation | military
- sentiment: one of: risk-on | risk-off | neutral | escalating | de-escalating
- url: source URL for the scheduled event or latest reporting (Reuters, AP, Bloomberg, WSJ, FT, etc.)
- alternateUrl: second independent source URL

ANALYSIS SECTION:
- dominantTheme: single sentence naming the overarching theme connecting most of these 10 events
- highestImpactEvent: name the single event with greatest potential market-moving power and why in 2 sentences
- overallRiskLevel: one of: LOW | MODERATE | ELEVATED | HIGH | CRITICAL
- watchlist: 3–4 key indicators or data points to monitor daily this week (e.g. "10Y yield above 4.5%", "USD/CNY rate", "VIX above 20")
- globalSocialPost: ≤280 character forward-looking tweet summarising the week's biggest risk

OUTPUT RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no text before or after.
2. All 10 events must have probability, effectIfHappens, effectIfDoesntHappen, markets, industries, and countries.
3. Sort events array by rank ascending (1 = highest expected impact).`;

  try {
    onProgress?.('Sending to AI provider...', 35, sourceStatuses);
    console.log('[generateForecastReport] Generating 7-day forecast...');
    const aiResponse = await generateReportWithFallback(prompt, ['claude', 'gpt'], 10000);
    onProgress?.('Parsing AI response...', 85, sourceStatuses);
    const parsed = parseJSONResponse<ForecastReport>(aiResponse);
    const warnings: string[] = [...(aiResponse.warnings || [])];

    if (!parsed.events?.length) throw new Error('No events in forecast response');
    if (parsed.events.length < 10) warnings.push(`Only ${parsed.events.length}/10 events generated — response may have been truncated.`);
    if (!parsed.analysis) warnings.push('Analysis section was missing.');

    parsed.events.sort((a, b) => a.rank - b.rank);
    onProgress?.('Complete', 100, sourceStatuses);
    console.log(`[generateForecastReport] ✓ Generated ${parsed.events.length} forecast events`);
    return { ...parsed, _sources: sourceStatuses, _warnings: warnings.length ? warnings : undefined };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[generateForecastReport] Failed:', msg);
    throw new Error(`Failed to generate forecast: ${msg}`);
  }
}

// ── Weekly report ─────────────────────────────────────────────────────────────

export async function generateWeeklyReport(type: string = 'global', customTopic?: string, onProgress?: ProgressCallback): Promise<WeeklyReport & { _sources?: SourceStatus[]; _warnings?: string[] }> {
  const cfg: ReportConfig = type === 'custom' && customTopic
    ? {
        topicFocus: customTopic,
        reportTitle: "Custom Intelligence Brief",
        timeframe: "last 90 days with 30-day forward outlook",
        timeframeDescriptor: "from the last 90 days, with forward-looking risk analysis for the next 30 days",
        sentimentVocab: "bullish | bearish | neutral | escalating | stable | de-escalating | critical | opportunity",
        maxTokens: 10000,
      }
    : (REPORT_CONFIGS[type] ?? REPORT_CONFIGS.global);

  const currentDate = formatCurrentDate();
  const trendingWeightInstructions = getTrendingWeightInstructions(type);

  const windowDays = cfg.isConspiracy ? 30 : 7;
  const windowStart = formatDateOffset(windowDays);

  // Fetch live RSS articles before calling the AI
  onProgress?.('Fetching news sources...', 10);
  console.log(`[generateWeeklyReport] Fetching live news for ${type}...`);
  const { text: liveNewsContext, sources: sourceStatuses } = await fetchNewsContext(type, windowDays);
  onProgress?.('Filtering & scoring articles...', 25, sourceStatuses);

  const conspiracyAddition = cfg.isConspiracy
    ? '\nCONSPIRACY REPORT: Focus on trending topics with LOW credibility from the last 30 days.\nInclude historical context from the last 20 years to show patterns and recurring themes.'
    : '';

  const mandatoryAreas = type === 'global' ? `MANDATORY COVERAGE AREAS — you MUST include at least one headline from each:
1. Active military conflicts (Ukraine-Russia, Middle East, any new flashpoints)
2. US / China / EU economic or trade policy
3. Energy markets (oil, gas, commodities)
4. Emerging market crises or political instability
5. Technology / AI regulation or major corporate development
Fill remaining slots with the highest-trendScore global stories available.

RECENCY: Prioritize last 72 hours. If nothing broke in 72h on a topic, use the most recent significant development.` : type === 'nasdaq' ? `MANDATORY COVERAGE AREAS — you MUST include at least one headline from each:
1. Mega-cap AI/cloud (NVDA, MSFT, GOOGL, META, AMZN)
2. Consumer tech (AAPL, TSLA)
3. Semiconductors or hardware (AVGO, AMD, INTC, QCOM)
4. Analyst calls or institutional moves on any Nasdaq-100 name
5. Macro catalyst directly affecting Nasdaq (Fed, rates, CPI if tech-relevant)
Fill remaining slots with the highest-trendScore Nasdaq-100 stories available.` : '';

  const prompt = `You are a factual intelligence analyst. Today is ${currentDate}.

CRITICAL INSTRUCTION — DATA SOURCE RULES:
1. You MUST base ALL headlines EXCLUSIVELY on the LIVE NEWS FEED provided below.
2. You are STRICTLY FORBIDDEN from using your training data knowledge to generate or supplement any headline, summary, or URL.
3. If a required category has no matching article in the live feed, mark it as "No live data available for this category" — do NOT invent or recall from memory.
4. Every headline's URL must come directly from the live feed articles. Do not construct or guess URLs.
5. Only include events that occurred between ${windowStart} and ${currentDate}. Reject anything outside this window even if it appears in the feed.

${liveNewsContext}

TASK: Using ONLY the live news articles above, generate exactly 20 headlines of MAJOR news events ${cfg.timeframeDescriptor}.
Topic scope: ${cfg.topicFocus}

${mandatoryAreas}

${type === 'conspiracies' ? 'HISTORICAL CONTEXT: Include patterns ongoing for years or decades, but prioritize what is trending RIGHT NOW in the last 30 days.' : ''}

${trendingWeightInstructions}

${conspiracyAddition}

HEADLINE FIELDS (repeat for all 20):
- title: factual headline ≤20 words — WHAT, WHERE, WHEN
- trendScore: integer 1–100 (trending weight as described above)
- summary: 150–200 words. Cover: what happened, who is involved, key numbers/dates, and why it matters strategically. Be specific and factual.
- url: primary source URL (Reuters, AP, Bloomberg, BBC, WSJ, FT, etc.)
- alternateUrl: second independent source URL (different publication)
- category: conflict | tension | diplomatic | strategic | military | economic | technology | market
- socialPost: ≤280 character standalone tweet. Do NOT copy the first sentence of the summary. Write a punchy, self-contained post with a hook, key fact, and context. Must read well on its own.
- sentiment: exactly one word from: ${cfg.sentimentVocab}

ANALYSIS SECTION:
- performanceRanking: top 3 stories ranked by strategic importance, one sentence each
- verificationScore: integer 1–100
- integrityScore: integer 1–100
- overallSummary: 100–150 word synthesis of dominant trends and forward outlook
- globalSocialPost: ≤280 character digest of the full report

OUTPUT RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no text before or after.
2. All 20 headlines must have a summary and a sentiment value.
3. Sort headlines array by trendScore descending before returning.`;

  try {
    onProgress?.('Sending to AI provider...', 35, sourceStatuses);
    console.log(`[generateWeeklyReport] Generating ${type} report...`);
    const aiResponse = await generateReportWithFallback(prompt, ["claude", "gpt"], cfg.maxTokens);
    onProgress?.('Parsing AI response...', 85, sourceStatuses);
    console.log(`[generateWeeklyReport] Using provider: ${aiResponse.provider}`);

    const parsed = parseJSONResponse<WeeklyReport>(aiResponse);
    const warnings: string[] = [...(aiResponse.warnings || [])];

    if (!parsed.headlines?.length) throw new Error("No headlines in response");

    if (parsed.headlines.length < 20) {
      warnings.push(`Only ${parsed.headlines.length}/20 headlines generated — response may have been truncated.`);
    }

    if (!parsed.analysis) {
      const topHeadline = parsed.headlines[0];
      const dominantSentiment = parsed.headlines.map(h => h.sentiment).find(Boolean) ?? 'escalating';
      parsed.analysis = {
        performanceRanking: `${parsed.headlines.length} intelligence items ranked by strategic impact and recency`,
        verificationScore: 87,
        integrityScore: 91,
        overallSummary: `This brief covers ${parsed.headlines.length} major developments. The top story: ${topHeadline?.title}. ${topHeadline?.summary?.slice(0, 200) || ''}`,
        globalSocialPost: `🔎 ${topHeadline?.title || 'Intelligence Brief'} — ${dominantSentiment} signal. Full analysis: globalpulse.io`,
      };
      warnings.push('Analysis section was missing — synthesized from headlines.');
      console.warn(`[generateWeeklyReport] ⚠ Missing analysis — synthesized fallback from headlines`);
    }

    parsed.headlines.sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));
    validateHeadlines(parsed.headlines);

    onProgress?.('Complete', 100, sourceStatuses);
    console.log(`[generateWeeklyReport] ✓ Generated ${parsed.headlines.length} headlines for ${cfg.reportTitle}`);
    return { ...parsed, _sources: sourceStatuses, _warnings: warnings.length ? warnings : undefined };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[generateWeeklyReport] ✗ Failed:`, errorMsg);
    throw new Error(`Failed to generate report: ${errorMsg}`);
  }
}

// ── Substack article ──────────────────────────────────────────────────────────

export async function generateSubstackArticle(report: WeeklyReport): Promise<string> {
  const headlinesBlock = report.headlines.map((h, i) =>
    `${i + 1}. **${h.title}** [${h.category.toUpperCase()}]\n${h.summary}`
  ).join('\n\n');

  const prompt = `You are a senior macro analyst and writer for ChokePoint Macro, a professional financial and geopolitical intelligence publication. Today is ${formatCurrentDate()}.

TASK: Write a Substack article of EXACTLY 2,000–2,500 words synthesising the 20 intelligence headlines below into a single coherent narrative for sophisticated readers.

ARTICLE STRUCTURE (follow exactly):
1. **HEADLINE** — a punchy, editorial-quality title for the article (not "Weekly Brief" — something specific and compelling)
2. **LEDE** (150–200 words) — a gripping opening paragraph that names the single most important theme tying these 20 stories together
3. **THE MACRO PICTURE** (400–500 words) — synthesise the top 5–7 headlines into the dominant global macro narrative. Identify cause-and-effect chains between stories. Be analytical, not descriptive.
4. **SECTOR DEEP-DIVE** (400–500 words) — pick the single most important sector (geopolitical, financial, technology, or energy) and analyse its 3–4 most significant developments in depth
5. **SIGNALS & NOISE** (300–350 words) — what to watch in the coming week: 3–4 forward-looking indicators or events that will confirm or deny the thesis
6. **BOTTOM LINE** (200–250 words) — concise, direct conclusion summarising actionable insight for investors and analysts. No fluff.
7. **EDITOR'S NOTE** (50–80 words) — short disclosure paragraph in ChokePoint Macro voice: data sourced from major news networks, analysis is for informational purposes only

TONE: Authoritative, analytical, direct. Think The Economist meets Zerohedge — sophisticated but not jargon-heavy. First-person plural ("we") is appropriate.

FORMATTING: Use markdown headers (##), bold for key terms, and keep paragraphs short (3–5 sentences max).

STRICT RULES:
1. Do NOT just summarise the headlines one by one — synthesise them into a narrative
2. Do NOT use bullet lists in the main body sections
3. Do NOT add hashtags or social language
4. Return ONLY the article text in markdown — no preamble, no "here is your article" intro

SOURCE HEADLINES:
${headlinesBlock}

OVERALL ANALYSIS:
${report.analysis.overallSummary}`;

  try {
    console.log("[generateSubstackArticle] Generating article...");
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "You are a senior financial and geopolitical intelligence analyst. Write in a professional, authoritative style.",
      messages: [{ role: "user", content: prompt }],
    });

    const article = response.content[0]?.type === "text" ? response.content[0].text : "";
    if (!article) throw new Error("Empty response from Claude");
    console.log("[generateSubstackArticle] ✓ Article generated");
    return article;
  } catch (error) {
    console.error("[generateSubstackArticle] Failed:", error);
    throw new Error("Failed to generate Substack article: " + (error instanceof Error ? error.message : String(error)));
  }
}

// ── Instagram caption ─────────────────────────────────────────────────────────

export async function generateInstagramCaption(report: WeeklyReport): Promise<string> {
  const headlinesList = report.headlines.map((h, i) => `${i + 1}. ${h.title}`).join('\n');

  const prompt = `Act as a social media strategist. I have a report with 20 critical news headlines from the last 7 days.

HEADLINES:
${headlinesList}

SUMMARY:
${report.analysis.overallSummary}

TASK:
Create a high-impact Instagram caption that summarizes these 20 points into one cohesive, engaging post.

STRICT REQUIREMENTS:
1. ABSOLUTE MAXIMUM LENGTH: ${INSTAGRAM_MAX_CHARS} characters (to leave a safety buffer for the 2,200 Instagram limit).
2. YOU MUST BE CONCISE. If you exceed ${INSTAGRAM_MAX_CHARS} characters, the post will be rejected.
3. Start with a hook that stops the scroll.
4. Group the 20 points into 3-4 major themes or megatrends.
5. Use bullet points for readability.
6. Maintain a sharp, insight-focused tone.
7. Include 5-10 relevant hashtags.
8. Do NOT just list the 20 headlines. Synthesize them.
`;

  console.log("[generateInstagramCaption] Starting caption generation...");

  try {
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2200,
      messages: [{ role: "user", content: prompt }],
    });
    const caption = response.content[0]?.type === "text" ? response.content[0].text : "";
    if (caption) {
      console.log("[generateInstagramCaption] ✓ Claude succeeded");
      return truncateToInstagram(caption);
    }
  } catch (claudeError) {
    console.warn("[generateInstagramCaption] Claude failed, trying GPT...", claudeError instanceof Error ? claudeError.message : String(claudeError));
  }

  try {
    const gpt = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
    const response = await gpt.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert social media strategist. Create viral Instagram captions." },
        { role: "user", content: prompt },
      ],
      max_tokens: 2200,
    });
    const caption = response.choices[0]?.message.content || "";
    if (caption) {
      console.log("[generateInstagramCaption] ✓ GPT succeeded");
      return truncateToInstagram(caption);
    }
  } catch (gptError) {
    console.error("[generateInstagramCaption] GPT failed:", gptError instanceof Error ? gptError.message : String(gptError));
  }

  return "Failed to generate Instagram caption. Please try again.";
}
