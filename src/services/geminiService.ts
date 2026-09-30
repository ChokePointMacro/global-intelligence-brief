import { generateReportWithFallback, generateTextWithFallback, parseJSONResponse } from "./aiService";

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
  /** Market trend weight 1–100 (drives scheduling slot priority). NOT social trending. */
  trendScore?: number;
  // ── Reach layer, added by the hashtag pass (see enrichWithHashtags) ──
  /** Topic hashtags, ordered broad → niche. */
  hashtags?: string[];
  /** Who these tags are meant to reach, and why. Shown in the UI, not posted. */
  hashtagRationale?: string;
  /** The community this post is aimed at. */
  audience?: string;
  /** socialPost + tags, ready to post. */
  socialPostWithTags?: string;
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
    // Sized for long-form socialPosts. Each headline now costs roughly 500 output tokens
    // (~230 summary + ~210 post + ~60 fields); 20 headlines plus the analysis section needs
    // ~11k. The old 8k budget truncated mid-response and salvaged only 14 headlines.
    maxTokens: 16000,
  },
  crypto: {
    topicFocus: "Cryptocurrency industry ONLY. Focus on Bitcoin, Ethereum, Altcoins, DeFi, Blockchain technology, NFTs, GameFi, Crypto regulation, exchange developments, and significant Web3 industry events. Omit non-crypto news.",
    reportTitle: "Crypto Industry Pulse",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    // Sized for long-form socialPosts. Each headline now costs roughly 500 output tokens
    // (~230 summary + ~210 post + ~60 fields); 20 headlines plus the analysis section needs
    // ~11k. The old 8k budget truncated mid-response and salvaged only 14 headlines.
    maxTokens: 16000,
  },
  equities: {
    topicFocus: "S&P 500 Equities ONLY. Focus on the top 500 US stocks, significant news, earnings results, and price movements for companies within the S&P 500. Omit all other macro news, geopolitics, or non-S&P 500 stocks.",
    reportTitle: "S&P 500 Momentum Report",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    // Sized for long-form socialPosts. Each headline now costs roughly 500 output tokens
    // (~230 summary + ~210 post + ~60 fields); 20 headlines plus the analysis section needs
    // ~11k. The old 8k budget truncated mid-response and salvaged only 14 headlines.
    maxTokens: 16000,
  },
  nasdaq: {
    topicFocus: "Nasdaq-100 tech and growth stocks ONLY. Focus on AAPL, NVDA, MSFT, META, AMZN, GOOGL, TSLA and other Nasdaq-100 constituents. Emphasise: AI/product announcements, earnings beats/misses, analyst upgrades/downgrades, rate-sensitive growth stock moves, and sector-wide tech themes. Omit S&P 500 non-tech names and macro news unless it directly moves Nasdaq prices.",
    reportTitle: "Nasdaq-100 Tech Pulse",
    timeframe: "last 7 days",
    timeframeDescriptor: "from the last 7 days",
    sentimentVocab: "bullish | bearish | neutral",
    // Sized for long-form socialPosts. Each headline now costs roughly 500 output tokens
    // (~230 summary + ~210 post + ~60 fields); 20 headlines plus the analysis section needs
    // ~11k. The old 8k budget truncated mid-response and salvaged only 14 headlines.
    maxTokens: 16000,
  },
  conspiracies: {
    topicFocus: "Widely viral, unverified or actively contested claims circulating on X (Twitter), TikTok, Facebook, Reddit, and Google. Focus on topics that are heavily discussed in mainstream social media but lack confirmation from established news sources — stories that are disputed, fact-checked as false, or still under investigation. Include historical context from the last 20 years where relevant, but prioritize what is trending in the last 30 days.",
    reportTitle: "The Conspiracy Pulse",
    timeframe: "last 30 days (with 20-year historical context)",
    timeframeDescriptor: "from the last 30 days",
    sentimentVocab: "viral | fading | debunked",
    maxTokens: 16000,
    isConspiracy: true,
  },
  china: {
    topicFocus: `Chinese influence, control, and leverage points in global supply chains — focusing on hidden dependencies that most market participants underestimate. Coverage must span: (1) Critical Minerals & Rare Earths — gallium, germanium, graphite, cobalt, NdFeB magnets and export control developments; (2) Agricultural Inputs — phosphate, fertilizer, potash supply chokepoints; (3) Pharmaceuticals — API/active pharmaceutical ingredient dependencies, heparin, generic drug supply; (4) Semiconductors & Electronics — PCB manufacturing, advanced packaging, ZPMC port cranes; (5) EV & Battery — CATL, LFP chemistry, graphite anode, lithium refining; (6) Maritime & Shipping — Chinese shipbuilding dominance, COSCO fleet movements, port infrastructure; (7) Military & Dual-Use — PLA modernization, Volt Typhoon/Salt Typhoon infrastructure access, technology transfer; (8) Trade Policy — US-China tariff escalation (Trump 2.0 145%), decoupling vs engagement debate, friend-shoring progress; (9) Foreign Investment — BRI project updates, Chinese FDI into critical resource nations, Western divestment pressures; (10) Risk Events — Taiwan strait tensions, export ban escalation, sanctions, commodity market manipulation. Emphasise non-obvious, high-consequence dependencies that cascade across industries if disrupted. Include investment and risk implications for each item.`,
    reportTitle: "China Supply Chain Intelligence",
    timeframe: "last 90 days with 30-day forward outlook",
    timeframeDescriptor: "from the last 90 days, with forward-looking risk and opportunity analysis for the next 30 days",
    sentimentVocab: "critical | escalating | opportunity | bullish | bearish | risk-off | stable | de-escalating",
    maxTokens: 16000,
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
- socialPost: standalone X post in the voice of a sharp market observer. The account has X Premium (25,000-character ceiling), so there is no limit to write to — and NO target length. Length is a judgement you make per story, governed by one structural fact:

  THE FOLD — X truncates every post in the timeline at roughly 280 characters behind a "Show more" link, Premium included. Almost every impression is of the first ~280 characters ONLY. Everything past the fold is seen solely by readers who chose to expand.

  Reason about length against that:
  * The first ~280 characters must be a COMPLETE, self-contained story: hook, the hardest number, why it matters. If a reader sees nothing else, they must still have learned something real. Never spend the opening on setup that pays off later — the payoff will be below the fold where nobody sees it.
  * If the story is fully told in under ~280 characters, STOP THERE. A post that needs no expansion earns clean impressions with no drop-off. Padding a thin story to look substantial is the most common and most costly failure.
  * Go past the fold ONLY when there is real substance that rewards expanding: the causal mechanism, the second-order effect, who is exposed, the credible counter-argument. Every sentence past the fold must carry information no earlier sentence did. A reader who expands and finds restatement will not expand again.
  * NEVER let a sentence be cut mid-thought at the fold. Land the opening as a clean block, then break with a blank line.
  * Judge by information density, not word count. Ask: does this story's importance justify the attention this length demands? A single-actor, single-number development almost never does. A multi-actor causal chain often does.

  Name entities explicitly and canonically — companies, countries, institutions, tickers, waterways, agencies. X classifies and distributes posts by reading the text semantically, so precise entity naming does more for reach than any hashtag.
  Format: if the post runs past the fold, use short paragraphs separated by blank lines.
  Do NOT copy the first sentence of the summary. Do NOT include hashtags or $ticker symbols — a later pass adds hashtags. Do NOT include URLs. No filler openers ("Breaking:", "Big news:"), no rhetorical questions, no emoji, no closing call-to-action.
- sentiment: exactly one word from: bullish | bearish | neutral | speculative | leaked | viral

ANALYSIS SECTION:
- performanceRanking: top 3 speculations ranked by potential market impact, one sentence each
- verificationScore: integer 1–100 (how sourced/corroborated is the overall set)
- integrityScore: integer 1–100 (signal-to-noise ratio of this batch)
- overallSummary: 100–150 words — what is the dominant speculative theme this week? What are the highest-conviction rumours? What should a trader be watching?
- globalSocialPost: standalone X post digesting the dominant speculative theme and the highest-conviction rumours. No character limit and NO target length — decide length from how much irreducible substance the digest actually carries. Every sentence must add something the previous did not; stop when the reader has the picture. Do not pad to seem thorough, do not compress a genuinely multi-part picture into one line. Break into short paragraphs beyond ~2 sentences. No hashtags, no URLs, no emoji.

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
- globalSocialPost: standalone X post digesting the week's biggest forward risk and its transmission mechanism. No character limit and NO target length — decide length from how much irreducible substance the digest actually carries. Every sentence must add something the previous did not; stop when the reader has the picture. Do not pad to seem thorough, do not compress a genuinely multi-part picture into one line. Break into short paragraphs beyond ~2 sentences. No hashtags, no URLs, no emoji.

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

export async function generateWeeklyReport(type: string = 'global', customTopic?: string, onProgress?: ProgressCallback, contentGuidance?: string): Promise<WeeklyReport & { _sources?: SourceStatus[]; _warnings?: string[] }> {
  const cfg: ReportConfig = type === 'custom' && customTopic
    ? {
        topicFocus: customTopic,
        reportTitle: "Custom Intelligence Brief",
        timeframe: "last 90 days with 30-day forward outlook",
        timeframeDescriptor: "from the last 90 days, with forward-looking risk analysis for the next 30 days",
        sentimentVocab: "bullish | bearish | neutral | escalating | stable | de-escalating | critical | opportunity",
        maxTokens: 16000,
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

  // Observed-performance guidance, edited by hand or proposed by the weekly audience
  // sample. It follows the generic spec so it wins where the two conflict — real data
  // from this account's own niche beats general assumptions about what works on X.
  const guidanceBlock = contentGuidance?.trim()
    ? `\nOBSERVED PERFORMANCE GUIDANCE — derived from a recent sample of what actually performs in this account's themes. Where this conflicts with the generic rules above, FOLLOW THIS:\n${contentGuidance.trim()}\n`
    : '';

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
- socialPost: standalone X post. The account has X Premium (25,000-character ceiling), so there is no limit to write to — and NO target length. Length is a judgement you make per story, governed by one structural fact:

  THE FOLD — X truncates every post in the timeline at roughly 280 characters behind a "Show more" link, Premium included. Almost every impression is of the first ~280 characters ONLY. Everything past the fold is seen solely by readers who chose to expand.

  Reason about length against that:
  * The first ~280 characters must be a COMPLETE, self-contained story: hook, the hardest number, why it matters. If a reader sees nothing else, they must still have learned something real. Never spend the opening on setup that pays off later — the payoff will be below the fold where nobody sees it.
  * If the story is fully told in under ~280 characters, STOP THERE. A post that needs no expansion earns clean impressions with no drop-off. Padding a thin story to look substantial is the most common and most costly failure.
  * Go past the fold ONLY when there is real substance that rewards expanding: the causal mechanism, the second-order effect, who is exposed, the credible counter-argument. Every sentence past the fold must carry information no earlier sentence did. A reader who expands and finds restatement will not expand again.
  * NEVER let a sentence be cut mid-thought at the fold. Land the opening as a clean block, then break with a blank line.
  * Judge by information density, not word count. Ask: does this story's importance justify the attention this length demands? A single-actor, single-number development almost never does. A multi-actor causal chain often does.

  Name entities explicitly and canonically — companies, countries, institutions, tickers, waterways, agencies. X classifies and distributes posts by reading the text semantically, so precise entity naming does more for reach than any hashtag.
  Format: if the post runs past the fold, use short paragraphs separated by blank lines.
  Do NOT copy the first sentence of the summary. Do NOT include hashtags or $ticker symbols — a later pass adds hashtags. Do NOT include URLs. No filler openers ("Breaking:", "Big news:"), no rhetorical questions, no emoji, no closing call-to-action.
- sentiment: exactly one word from: ${cfg.sentimentVocab}

${guidanceBlock}
ANALYSIS SECTION:
- performanceRanking: top 3 stories ranked by strategic importance, one sentence each
- verificationScore: integer 1–100
- integrityScore: integer 1–100
- overallSummary: 100–150 word synthesis of dominant trends and forward outlook
- globalSocialPost: standalone X post digesting the single theme tying these stories together. No character limit and NO target length — decide length from how much irreducible substance the digest actually carries. Every sentence must add something the previous did not; stop when the reader has the picture. Do not pad to seem thorough, do not compress a genuinely multi-part picture into one line. Break into short paragraphs beyond ~2 sentences. No hashtags, no URLs, no emoji.

OUTPUT RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no text before or after.
2. All 20 headlines must have a summary and a sentiment value.
3. Sort headlines array by trendScore descending before returning.
4. The response MUST be a single object with EXACTLY these two top-level keys:
   {"headlines": [ ...20 headline objects... ], "analysis": { ...the analysis object... }}
   The "analysis" key is REQUIRED and is a sibling of "headlines", not nested inside it.
   A response containing only "headlines" is invalid and will be rejected.`;

  try {
    onProgress?.('Sending to AI provider...', 35, sourceStatuses);
    console.log(`[generateWeeklyReport] Generating ${type} report...`);
    // Map token generation onto the 35→82 band so the bar moves continuously through
    // the long AI call instead of freezing at 35% for minutes.
    const aiResponse = await generateReportWithFallback(prompt, ["claude", "gpt"], cfg.maxTokens, `report_${type}`,
      (tokensSoFar, maxTokens) => {
        const frac = Math.min(1, tokensSoFar / Math.max(1, maxTokens * 0.9));
        onProgress?.(`Writing report — ${Math.round(frac * 100)}% of expected length`, 35 + frac * 47, sourceStatuses);
      });
    onProgress?.('Parsing AI response...', 85, sourceStatuses);
    console.log(`[generateWeeklyReport] Using provider: ${aiResponse.provider}`);

    const parsed = parseJSONResponse<WeeklyReport>(aiResponse);
    const warnings: string[] = [...(aiResponse.warnings || [])];

    if (!parsed.headlines?.length) throw new Error("No headlines in response");

    if (parsed.headlines.length < 20) {
      warnings.push(`Only ${parsed.headlines.length}/20 headlines generated — response may have been truncated.`);
    }

    if (!parsed.analysis) {
      // The model omitted a required key — measured at roughly 1 in 4 otherwise-clean
      // runs. Ask for just the analysis rather than shipping a canned template: it is a
      // small, cheap call and produces real content instead of a placeholder.
      console.warn(`[generateWeeklyReport] Analysis missing — attempting targeted repair call`);
      try {
        const repairPrompt = `You are a factual intelligence analyst. Below are ${parsed.headlines.length} headlines from a ${cfg.reportTitle} generated today.

${parsed.headlines.map((h, i) => `${i + 1}. [${h.category}] ${h.title}\n${(h.summary || '').slice(0, 300)}`).join('\n\n')}

Produce ONLY the analysis object for this report as valid JSON, no markdown:
{"analysis":{"performanceRanking":"...","verificationScore":87,"integrityScore":91,"overallSummary":"...","globalSocialPost":"..."}}

- performanceRanking: top 3 stories by strategic importance, one sentence each
- verificationScore / integrityScore: integers 1-100
- overallSummary: 100-150 word synthesis of dominant trends and forward outlook
- globalSocialPost: standalone X post digesting the single theme tying these stories together. No target length — decide it from how much substance the digest carries. No hashtags, no URLs, no emoji.`;
        const repair = await generateReportWithFallback(repairPrompt, ["claude", "gpt"], 2000, `analysis_repair_${type}`);
        const repaired = parseJSONResponse<{ analysis: Analysis }>(repair);
        if (repaired?.analysis?.overallSummary) {
          parsed.analysis = repaired.analysis;
          warnings.push('Analysis section was missing from the main response and was regenerated in a follow-up call.');
          console.log(`[generateWeeklyReport] ✓ Analysis repaired via follow-up call`);
        }
      } catch (repairErr) {
        console.warn(`[generateWeeklyReport] Analysis repair failed:`, repairErr instanceof Error ? repairErr.message : repairErr);
      }
    }

    if (!parsed.analysis) {
      const topHeadline = parsed.headlines[0];
      const dominantSentiment = parsed.headlines.map(h => h.sentiment).find(Boolean) ?? 'escalating';
      parsed.analysis = {
        performanceRanking: `${parsed.headlines.length} intelligence items ranked by strategic impact and recency`,
        verificationScore: 87,
        integrityScore: 91,
        overallSummary: `This brief covers ${parsed.headlines.length} major developments. The top story: ${topHeadline?.title}. ${topHeadline?.summary?.slice(0, 200) || ''}`,
        // Fallback digest, used when the model omits the analysis section. Deliberately
        // carries no emoji and no URL: a link costs 30-50% of reach and moves the post
        // into the $0.20 billing tier. The previous template did both.
        globalSocialPost: [
          topHeadline?.title || 'Intelligence brief',
          '',
          `Lead signal across ${parsed.headlines.length} developments today: ${dominantSentiment}.`,
        ].join('\n'),
      };
      warnings.push('Analysis section was missing — synthesized from headlines.');
      console.warn(`[generateWeeklyReport] ⚠ Missing analysis — synthesized fallback from headlines`);
    }

    parsed.headlines.sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));
    validateHeadlines(parsed.headlines);

    // Second pass: analyse the finished posts and attach reach tags.
    onProgress?.('Analysing reach / hashtags...', 92, sourceStatuses);
    try {
      await enrichWithHashtags(parsed, (frac) =>
        onProgress?.(`Analysing reach / hashtags — ${Math.round(frac * 100)}%`, 92 + frac * 7, sourceStatuses));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hashtag analysis failed — posts are usable without tags. (${msg})`);
      console.warn(`[generateWeeklyReport] ⚠ Hashtag pass failed:`, msg);
      applyFallbackTags(parsed);
    }

    onProgress?.('Complete', 100, sourceStatuses);
    console.log(`[generateWeeklyReport] ✓ Generated ${parsed.headlines.length} headlines for ${cfg.reportTitle}`);
    return { ...parsed, _sources: sourceStatuses, _warnings: warnings.length ? warnings : undefined };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[generateWeeklyReport] ✗ Failed:`, errorMsg);
    throw new Error(`Failed to generate report: ${errorMsg}`);
  }
}

// ── Reach / hashtag analysis ──────────────────────────────────────────────────

/** Hard ceiling, set from measured engagement rather than intuition.
 *  On X: 1–2 hashtags ≈ +21% engagement vs none; 3+ ≈ −17%; 5+ ≈ −40%. Two is the ceiling,
 *  and one excellent tag beats two mediocre ones.
 *  Hashtags no longer drive distribution — X ranks by reading the post text semantically,
 *  so tags are search/indexing labels, not reach levers.
 *  Cashtags are deliberately not used on this account. */
const MAX_HASHTAGS = 2;

/** Generic reach-bait that attracts bots and followers who never engage. */
const BANNED_TAGS = new Set([
  'follow', 'followback', 'f4f', 'like4like', 'viral', 'trending', 'fyp',
  'money', 'rich', 'wealth', 'investing101', 'stocks', 'trading', 'news',
  'breaking', 'update', 'mustread', 'thread', 'retweet',
]);

/** Normalise and validate a hashtag. */
const normaliseTag = (raw: string): string | null => {
  const cleaned = String(raw || '').trim().replace(/^[#$]+/, '').replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return null;
  if (cleaned.length < 3 || cleaned.length > 24) return null;
  if (BANNED_TAGS.has(cleaned.toLowerCase())) return null;
  return `#${cleaned}`;
};

/** X Premium long-form ceiling. Mirrors X_MAX_POST_CHARS in server.ts — the free-tier
 *  280 cap no longer applies, and defaulting to it here silently stripped every tag off
 *  any post longer than a legacy tweet. */
export const X_POST_CHAR_CEILING = 25000;

/** Join a post with its tags, trimming tags (lowest priority first) to fit the budget.
 *  At the long-form ceiling trimming effectively never fires; it exists so that setting
 *  a tighter budget (e.g. free-tier 280) still degrades gracefully instead of overflowing. */
export function composePostWithTags(post: string, hashtags: string[], budget = X_POST_CHAR_CEILING): string {
  const base = (post || '').trim();
  let tags = [...hashtags];
  while (tags.length && `${base}\n\n${tags.join(' ')}`.length > budget) tags.pop();
  return tags.length ? `${base}\n\n${tags.join(' ')}` : base;
}

/** Deterministic fallback so a failed AI pass never leaves posts bare. */
function applyFallbackTags(report: WeeklyReport): void {
  const byCategory: Record<string, string[]> = {
    conflict: ['#Geopolitics', '#NatSec'], tension: ['#Geopolitics', '#Chokepoints'],
    diplomatic: ['#Geopolitics'], strategic: ['#Geopolitics', '#Chokepoints'],
    military: ['#NatSec', '#Defense'], economic: ['#Macro', '#Markets'],
    technology: ['#Tech', '#Semiconductors'], market: ['#Macro', '#Markets'],
    crypto: ['#Bitcoin', '#Crypto'], currency: ['#Macro', '#FX'], macro: ['#Macro', '#Markets'],
  };
  for (const h of report.headlines) {
    if (h.socialPostWithTags) continue;
    h.hashtags = h.hashtags?.length ? h.hashtags : (byCategory[h.category] || ['#Macro']);
    h.socialPostWithTags = composePostWithTags(h.socialPost, h.hashtags);
  }
}

/**
 * Second AI pass: read each finished post and choose tags that widen its reach.
 *
 * Deliberately separate from generation. Asking one prompt to both write the story and
 * pick tags produces tags that echo the words already in the post — which reaches nobody
 * new. This pass sees the finished text and answers a different question: which existing
 * communities would want this in front of them?
 *
 * Batched into one call for the whole report rather than one per headline — 20x cheaper
 * and lets the model spread tags across the set instead of stamping #Geopolitics on all 20.
 */
export async function enrichWithHashtags(report: WeeklyReport, onTick?: (frac: number) => void): Promise<void> {
  const posts = report.headlines.map((h, i) =>
    `[${i}] category=${h.category} | sentiment=${h.sentiment ?? 'n/a'}\nTITLE: ${h.title}\nPOST: ${h.socialPost}`
  ).join('\n\n');

  const prompt = `You are a social growth strategist for ChokePoint Macro, an account publishing macro, geopolitics and market intelligence. Today is ${formatCurrentDate()}.

TASK: For each numbered post below, choose the hashtags that put it in front of the largest relevant ENGAGED audience. The goal is reaching people who already discuss this subject matter and will reply, quote and follow — not raw impressions.

WHAT ACTUALLY DRIVES REACH ON X NOW — read this before choosing:
X no longer distributes by hashtag. It ranks and categorises posts by reading the TEXT semantically. Hashtags are search/indexing labels, not reach levers. Measured effect: 1–2 hashtags ≈ +21% engagement versus none, 3+ ≈ −17%, 5+ ≈ −40%. More tags is not more reach — it is measurably less.

TAG STRATEGY:
1. Choose AT MOST ${MAX_HASHTAGS} hashtags. ONE genuinely well-targeted tag beats two mediocre ones. Return zero ONLY if you genuinely cannot name a community that discusses this subject — that is rare. Advocacy, professional, regional and industry communities exist for almost every story (a femicide story has #GBV and #Femicide; a prison-corruption story has an anti-corruption community). Do not default to zero out of caution; find the community first, and return empty only if there truly isn't one.
2. Prefer the NICHE COMMUNITY tag over the broad one. Broad tags (#Markets, #News, #Finance) are saturated and contribute almost nothing; the engaged audience lives in specific tags (#OOTT, #Chokepoints, #SupplyChain, #Semiconductors, #Sanctions, #Shipping, #CentralBanks, #DeDollarization). If you pick two, make them one community tag plus one adjacent-community tag that reaches a DIFFERENT group — never two synonyms.

HARD RULES:
- Use tags REAL PEOPLE ACTIVELY USE on X today. Never invent a plausible-sounding tag; an unused tag reaches precisely zero people and just adds noise.
- Do NOT restate words already in the post. A tag echoing the post's own nouns adds no audience — the semantic ranker already extracted those entities. A tag earns its place only by reaching a community the text alone would miss.
- Spread tags across the set. Do not stamp one broad tag on every post.
- NEVER return $ticker cashtags. This account does not use them. Hashtags only.
- No generic engagement bait (#viral #trending #news #breaking #investing101 #follow).
- Tags must be safe for a professional finance/geopolitics account. No political-partisan slogans, no conspiracy community tags, nothing that would embarrass an institutional reader.

For each post also return:
- audience: 3–8 words naming the specific community these tags target (e.g. "energy traders and shipping analysts")
- rationale: ONE sentence explaining why these tags reach beyond the post's existing readers.

POSTS:
${posts}

OUTPUT — return ONLY valid JSON, no markdown, no commentary:
{"tags":[{"index":0,"hashtags":["#Tag1","#Tag2"],"audience":"...","rationale":"..."}]}
Return one entry for every post index 0–${report.headlines.length - 1}.`;

  const aiResponse = await generateReportWithFallback(prompt, ["claude", "gpt"], 4000, 'hashtag_pass',
    onTick ? (tokensSoFar, maxTokens) => onTick(Math.min(1, tokensSoFar / Math.max(1, maxTokens * 0.8))) : undefined);
  const parsed = parseJSONResponse<{ tags: Array<{ index: number; hashtags?: string[]; audience?: string; rationale?: string }> }>(aiResponse);

  if (!parsed?.tags?.length) throw new Error('Hashtag pass returned no tags');

  for (const entry of parsed.tags) {
    const h = report.headlines[entry.index];
    if (!h) continue;
    h.hashtags = (entry.hashtags || []).map(t => normaliseTag(t)).filter((t): t is string => !!t).slice(0, MAX_HASHTAGS);

    h.audience = entry.audience;
    h.hashtagRationale = entry.rationale;
    h.socialPostWithTags = composePostWithTags(h.socialPost, h.hashtags);
  }

  // Anything the model skipped still gets usable tags.
  applyFallbackTags(report);
  console.log(`[enrichWithHashtags] ✓ tagged ${parsed.tags.length}/${report.headlines.length} posts via ${aiResponse.provider}`);
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
    // Routed through the fallback chain rather than the Anthropic SDK directly, so this
    // survives a Claude outage and is metered like every other call.
    const response = await generateTextWithFallback(prompt, ["claude", "gpt"], 4000, 'substack_article',
      "You are a senior financial and geopolitical intelligence analyst. Write in a professional, authoritative style.");
    const article = response.content;
    if (!article) throw new Error("Empty response from AI providers");
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

  // Was ~35 lines of hand-rolled Claude-then-GPT fallback duplicating the shared chain,
  // with its own spend reporting and its own divergent error handling.
  try {
    const response = await generateTextWithFallback(prompt, ["claude", "gpt"], 2200, 'instagram_caption',
      "You are an expert social media strategist. Create engaging Instagram captions.");
    if (response.content) return truncateToInstagram(response.content);
  } catch (err) {
    console.error("[generateInstagramCaption] all providers failed:", err instanceof Error ? err.message : String(err));
  }

  return "Failed to generate Instagram caption. Please try again.";
}
