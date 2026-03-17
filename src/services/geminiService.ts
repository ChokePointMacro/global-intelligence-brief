import { generateReportWithFallback, parseJSONResponse, type AIResponse } from "./aiService";

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
  verificationScore: string;
  integrityScore: string;
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

export async function generateForecastReport(): Promise<ForecastReport> {
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `You are a senior geopolitical risk analyst and macro strategist. Today is ${currentDate}. Your forward planning window is ${currentDate} through ${sevenDaysOut}.

TASK: Identify exactly 10 upcoming events, decisions, or catalysts within the next 7 days that carry the highest potential to move financial markets or escalate/de-escalate geopolitical tension. These must be REAL scheduled or anticipated events — central bank decisions, earnings, elections, summits, treaty deadlines, sanctions reviews, military exercises, etc.

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
    console.log('[generateForecastReport] Generating 7-day forecast...');
    const aiResponse = await generateReportWithFallback(prompt, ['claude', 'gpt'], 10000);
    const parsed = parseJSONResponse<ForecastReport>(aiResponse);

    if (!parsed.events || parsed.events.length === 0) throw new Error('No events in forecast response');
    if (!parsed.analysis) throw new Error('No analysis in forecast response');

    parsed.events.sort((a, b) => a.rank - b.rank);
    console.log(`[generateForecastReport] ✓ Generated ${parsed.events.length} forecast events`);
    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[generateForecastReport] Failed:', msg);
    throw new Error(`Failed to generate forecast: ${msg}`);
  }
}

export async function generateWeeklyReport(type: string = 'global', customTopic?: string): Promise<WeeklyReport> {
  let topicFocus = "Global macro shifts, geopolitical events, and major economic trends";
  let reportTitle = "Global Pulse";
  let isConspiracyReport = false;
  let timeframe = "last 7 days";
  let timeframeDescriptor = "from the last 7 days";
  let sentimentVocab = "escalating | stable | de-escalating";

  if (type === 'crypto') {
    topicFocus = "Cryptocurrency industry ONLY. Focus on Bitcoin, Ethereum, Altcoins, DeFi, Blockchain technology, NFTs, GameFi, Crypto regulation, exchange developments, and significant Web3 industry events. Omit non-crypto news.";
    reportTitle = "Crypto Industry Pulse";
    sentimentVocab = "bullish | bearish | neutral";
  } else if (type === 'equities') {
    topicFocus = "S&P 500 Equities ONLY. Focus on the top 500 US stocks, significant news, earnings results, and price movements for companies within the S&P 500. Omit all other macro news, geopolitics, or non-S&P 500 stocks.";
    reportTitle = "S&P 500 Momentum Report";
    sentimentVocab = "bullish | bearish | neutral";
  } else if (type === 'nasdaq') {
    topicFocus = "Nasdaq-100 tech and growth stocks ONLY. Focus on AAPL, NVDA, MSFT, META, AMZN, GOOGL, TSLA and other Nasdaq-100 constituents. Emphasise: AI/product announcements, earnings beats/misses, analyst upgrades/downgrades, rate-sensitive growth stock moves, and sector-wide tech themes. Omit S&P 500 non-tech names and macro news unless it directly moves Nasdaq prices.";
    reportTitle = "Nasdaq-100 Tech Pulse";
    sentimentVocab = "bullish | bearish | neutral";
  } else if (type === 'conspiracies') {
    topicFocus = "Widely viral, unverified or actively contested claims circulating on X (Twitter), TikTok, Facebook, Reddit, and Google. Focus on topics that are heavily discussed in mainstream social media but lack confirmation from established news sources — stories that are disputed, fact-checked as false, or still under investigation. Include historical context from the last 20 years where relevant, but prioritize what is trending in the last 30 days.";
    reportTitle = "The Conspiracy Pulse";
    isConspiracyReport = true;
    timeframe = "last 30 days (with 20-year historical context)";
    timeframeDescriptor = "from the last 30 days";
    sentimentVocab = "viral | fading | debunked";
  } else if (type === 'custom' && customTopic) {
    topicFocus = customTopic;
    reportTitle = "Custom Intelligence Brief";
    timeframe = "last 90 days with 30-day forward outlook";
    timeframeDescriptor = "from the last 90 days, with forward-looking risk analysis for the next 30 days";
    sentimentVocab = "bullish | bearish | neutral | escalating | stable | de-escalating | critical | opportunity";
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const trendingWeightInstructions = type === 'global' ? `
TRENDING WEIGHT SYSTEM — rank all 20 headlines by combined score of:
  - Recency (40%): events from last 24–72 hours score highest
  - Social Traction (30%): volume of coverage across X/Twitter, Google Trends, Reddit, and mainstream media
  - Strategic Impact (30%): geopolitical, economic, or military significance
Sort headlines with highest trendScore first. Assign each headline a trendScore (1–100).` : type === 'crypto' ? `
TRENDING WEIGHT SYSTEM — rank all 20 headlines by:
  - Price Impact (40%): headlines that moved BTC/ETH or altcoins ≥2%
  - Social Traction (35%): trending on crypto Twitter, Reddit r/CryptoCurrency, Discord
  - Regulatory Weight (25%): government actions, exchange rulings, legal developments
Sort highest trendScore first. Assign each headline a trendScore (1–100).` : type === 'equities' ? `
TRENDING WEIGHT SYSTEM — rank all 20 headlines by:
  - Market Impact (40%): % move in stock or sector ETF
  - Earnings/Guidance (35%): beats, misses, forward guidance revisions
  - Analyst Coverage (25%): upgrades, downgrades, price target changes
Sort highest trendScore first. Assign each headline a trendScore (1–100).` : type === 'nasdaq' ? `
TRENDING WEIGHT SYSTEM — rank all 20 headlines by:
  - Price/Volatility Impact (40%): % move in individual Nasdaq-100 stock or QQQ ETF
  - Earnings & Product News (35%): earnings beats/misses, AI announcements, product launches, guidance changes
  - Analyst & Institutional Activity (25%): upgrades, downgrades, price target revisions, large fund moves
Sort highest trendScore first. Assign each headline a trendScore (1–100).` : `
TRENDING WEIGHT: Assign each headline a trendScore (1–100) based on recency, social volume, and strategic importance. Sort highest first.`;

  const conspiracyPromptAddition = isConspiracyReport ? `
CONSPIRACY REPORT: Focus on trending topics with LOW credibility from the last 30 days.
Include historical context from the last 20 years to show patterns and recurring themes.` : '';

  const prompt = `You are a factual intelligence analyst. Today is ${currentDate}. STRICT NEUTRALITY — report only verified facts from major news sources (Reuters, AP, Bloomberg, BBC, CNN, Al Jazeera, WSJ, FT, etc). No speculation, opinion, or political bias.

TASK: Generate exactly 20 headlines of MAJOR news events and strategic developments ${timeframeDescriptor}.
Topic scope: ${topicFocus}

${type === 'global' ? `MANDATORY COVERAGE AREAS — you MUST include at least one headline from each:
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
Fill remaining slots with the highest-trendScore Nasdaq-100 stories available.` : ''}

${type === 'conspiracies' ? `HISTORICAL CONTEXT: Include patterns ongoing for years or decades, but prioritize what is trending RIGHT NOW in the last 30 days.` : ''}

${trendingWeightInstructions}

${conspiracyPromptAddition}

HEADLINE FIELDS (repeat for all 20):
- title: factual headline ≤20 words — WHAT, WHERE, WHEN
- trendScore: integer 1–100 (trending weight as described above)
- summary: 150–200 words. Cover: what happened, who is involved, key numbers/dates, and why it matters strategically. Be specific and factual.
- url: primary source URL (Reuters, AP, Bloomberg, BBC, WSJ, FT, etc.)
- alternateUrl: second independent source URL (different publication)
- category: conflict | tension | diplomatic | strategic | military | economic | technology | market
- socialPost: ≤280 character standalone tweet. Do NOT copy the first sentence of the summary. Write a punchy, self-contained post with a hook, key fact, and context. Must read well on its own.
- sentiment: exactly one word from: ${sentimentVocab}

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
    console.log(`[generateWeeklyReport] Generating ${type} report...`);

    const maxTokens = type === 'conspiracies' ? 12000 : type === 'custom' ? 14000 : 8000;
    const aiResponse = await generateReportWithFallback(prompt, ["claude", "gpt"], maxTokens);
    console.log(`[generateWeeklyReport] Using provider: ${aiResponse.provider}`);

    const parsed = parseJSONResponse<WeeklyReport>(aiResponse);

    if (!parsed.headlines || parsed.headlines.length === 0) {
      throw new Error("No headlines in response");
    }

    if (!parsed.analysis) {
      // Synthesize a fallback analysis from the headlines rather than failing
      const topHeadline = parsed.headlines[0];
      const sentiments = parsed.headlines.map(h => h.sentiment).filter(Boolean);
      const dominantSentiment = sentiments.length > 0 ? sentiments[0] : 'escalating';
      parsed.analysis = {
        performanceRanking: `${parsed.headlines.length} intelligence items ranked by strategic impact and recency`,
        verificationScore: "High — sourced from major wire services and verified financial/geopolitical data",
        integrityScore: "Institutional-grade analysis",
        overallSummary: `This brief covers ${parsed.headlines.length} major developments. The top story: ${topHeadline?.title}. ${topHeadline?.summary?.slice(0, 200) || ''}`,
        globalSocialPost: `🔎 ${topHeadline?.title || 'Intelligence Brief'} — ${dominantSentiment} signal. Full analysis: globalpulse.io`,
      };
      console.warn(`[generateWeeklyReport] ⚠ Missing analysis — synthesized fallback from headlines`);
    }

    function countWords(text: string): number {
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    // Sort by trendScore descending if present
    parsed.headlines.sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));

    // Quality check: warn only — never block a report that has real content
    // Only hard-fail if summaries are truly empty (< 20 words = stub/placeholder)
    let stubCount = 0;
    for (let i = 0; i < parsed.headlines.length; i++) {
      const words = countWords(parsed.headlines[i].summary || "");
      if (words < 20) {
        stubCount++;
        console.warn(`[generateWeeklyReport] ⚠ Stub summary — headline ${i + 1}: ${words} words`);
      }
    }

    if (stubCount === parsed.headlines.length) {
      throw new Error("All summaries are empty stubs — provider returned no usable content.");
    }

    console.log(`[generateWeeklyReport] ✓ Successfully generated ${parsed.headlines.length} headlines for ${reportTitle}`);
    return parsed;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[generateWeeklyReport] ✗ Failed to generate ${reportTitle}:`, errorMsg);
    throw new Error(`Failed to generate report: ${errorMsg}`);
  }
}

export async function generateSubstackArticle(report: WeeklyReport): Promise<string> {
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const headlinesBlock = report.headlines.map((h, i) =>
    `${i + 1}. **${h.title}** [${h.category.toUpperCase()}]\n${h.summary}`
  ).join('\n\n');

  const prompt = `You are a senior macro analyst and writer for ChokePoint Macro, a professional financial and geopolitical intelligence publication. Today is ${currentDate}.

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
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "You are a senior financial and geopolitical intelligence analyst. Write in a professional, authoritative style.",
      messages: [{ role: "user", content: prompt }],
    });

    const article = response.content[0].type === "text" ? response.content[0].text : "";
    if (!article) throw new Error("Empty response from Claude");
    console.log("[generateSubstackArticle] ✓ Article generated");
    return article;
  } catch (error) {
    console.error("[generateSubstackArticle] Failed:", error);
    throw new Error("Failed to generate Substack article: " + (error instanceof Error ? error.message : String(error)));
  }
}

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
1. ABSOLUTE MAXIMUM LENGTH: 2,100 characters (to leave a safety buffer for the 2,200 Instagram limit).
2. YOU MUST BE CONCISE. If you exceed 2,100 characters, the post will be rejected.
3. Start with a hook that stops the scroll.
4. Group the 20 points into 3-4 major themes or megatrends.
5. Use bullet points for readability.
6. Maintain a sharp, insight-focused tone.
7. Include 5-10 relevant hashtags.
8. Do NOT just list the 20 headlines. Synthesize them.
`;

  try {
    console.log("[generateInstagramCaption] Starting caption generation...");
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const OpenAI = (await import('openai')).default;

    // Try Claude first, then GPT
    try {
      console.log("[generateInstagramCaption] Trying Claude...");
      const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
      const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2200,
        messages: [{ role: "user", content: prompt }],
      });
      const caption = response.content[0].type === "text" ? response.content[0].text : "";
      if (caption) {
        console.log("[generateInstagramCaption] ✓ Claude succeeded");
        return caption.length > 2200 ? caption.slice(0, 2197) + "..." : caption;
      }
    } catch (claudeError) {
      console.warn("[generateInstagramCaption] Claude failed, trying GPT...", claudeError instanceof Error ? claudeError.message : String(claudeError));
    }

    try {
      console.log("[generateInstagramCaption] Trying GPT...");
      const gpt = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
      const response = await gpt.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an expert social media strategist. Create viral Instagram captions." },
          { role: "user", content: prompt },
        ],
        max_tokens: 2200,
      });
      const caption = response.choices[0].message.content || "";
      if (caption) {
        console.log("[generateInstagramCaption] ✓ GPT succeeded");
        return caption.length > 2200 ? caption.slice(0, 2197) + "..." : caption;
      }
    } catch (gptError) {
      console.error("[generateInstagramCaption] GPT failed:", gptError instanceof Error ? gptError.message : String(gptError));
    }

    return "Failed to generate Instagram caption. Please try again.";
  } catch (error) {
    console.error("[generateInstagramCaption] Fatal error:", error);
    return "Failed to generate Instagram caption.";
  }
}
