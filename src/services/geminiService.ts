import { generateReportWithFallback, parseJSONResponse, type AIResponse } from "./aiService";

export interface Headline {
  title: string;
  summary: string;
  url: string;
  category: string;
  socialPost: string;
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

export async function generateWeeklyReport(type: string = 'global'): Promise<WeeklyReport> {
  let topicFocus = "Global macro shifts, geopolitical events, and major economic trends";
  let reportTitle = "Global Pulse";
  let isConspiracyReport = false;
  let timeframe = "last 90 days";
  let timeframeDescriptor = "from the last 90 days";

  if (type === 'crypto') {
    topicFocus = "Cryptocurrency industry ONLY. Focus on Bitcoin, Ethereum, Altcoins, DeFi, Blockchain technology, Crypto regulation, and significant Web3 industry events. Omit non-crypto news.";
    reportTitle = "Crypto Industry Pulse";
    timeframe = "last 7 days";
    timeframeDescriptor = "from the last 7 days";
  } else if (type === 'equities') {
    topicFocus = "S&P 500 Equities ONLY. Focus on the top 500 US stocks, significant news, headlines, and price movements for companies within the S&P 500. Omit all other macro news, geopolitics, or non-S&P 500 stocks.";
    reportTitle = "S&P 500 Momentum Report";
    timeframe = "last 7 days";
    timeframeDescriptor = "from the last 7 days";
  } else if (type === 'conspiracies') {
    topicFocus = "Trending topics, viral claims, and widespread discussions from X (Twitter), TikTok, Facebook, and Google that have been reported but have LOW VERIFICATION STATUS. Focus ONLY on topics with below 50% confidence levels - claims that are heavily discussed but highly questionable. Include historical context from the last 20 years, but prioritize recent developments from the last 30 days.";
    reportTitle = "The Conspiracy Pulse";
    isConspiracyReport = true;
    timeframe = "last 30 days (with 20-year historical context)";
    timeframeDescriptor = "from the last 30 days";
  } else {
    timeframe = "last 3 days";
    timeframeDescriptor = "from the last 3 days";
  }

  const currentDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const conspiracyPromptAddition = isConspiracyReport ? `
    CONSPIRACY REPORT: Focus on trending topics with LOW credibility from the last 30 days.
    Include historical context from the last 20 years to show patterns and recurring themes.
    ` : '';

  const prompt = `You are a factual intelligence analyst. Today is ${currentDate}. STRICT NEUTRALITY - Report only verified facts from major news sources (Reuters, AP, Bloomberg, BBC, CNN, Al Jazeera, etc). No speculation, opinion, or political bias.

TASK: Generate exactly 20 headlines of MAJOR news events and strategic developments ${timeframeDescriptor}, prioritizing critical issues:
${topicFocus}

${type === 'global' ? `CRITICAL: For global geopolitics, MUST INCLUDE coverage of:
- Iran-Israel tensions and military developments
- Ukraine-Russia conflict
- Taiwan-China strategic tensions
- Middle East conflicts
- Other major geopolitical crises

RECENCY CRITICAL: Focus on developments from the LAST 3 DAYS. Only include breaking news and recent escalations, not older developments.` : ''}

${type === 'conspiracies' ? `HISTORICAL CONTEXT: Include patterns that have been ongoing for years or decades, but prioritize what's trending RIGHT NOW in the last 30 days.` : ''}

FOCUS ON: Real events, developments, and trends that are documented by major sources. For ${type}, prioritize ${timeframe}.

${conspiracyPromptAddition}

For EACH headline provide:
- title: factual headline (under 25 words) - WHAT, WHERE, WHEN
- summary: MANDATORY MINIMUM 300 WORDS. Approximately 1900+ characters. DO NOT UNDER 280 WORDS. Must comprehensively cover: (1) Specific event details - exactly what happened, (2) People/organizations involved - named countries, leaders, groups, (3) Precise timeline and dates, (4) Historical context and background (5) International reactions and statements, (6) Military/economic/diplomatic implications. Expand on each section with facts.
- url: major news source URL
- category: conflict/tension/diplomatic/strategic/military/economic
- socialPost: 280 character summary

Then create analysis section with:
- performanceRanking: 3-5 critical developments by strategic importance (250+ words)
- verificationScore: 1-100 (major news source confirmation)
- integrityScore: 1-100 (situation stability)
- overallSummary: 350+ words factual assessment of trends
- globalSocialPost: 280 character summary

STRICT RULES: 
1. No summary under 280 words. Expand details, add context, and explain implications. Summaries must be comprehensive and substantive.
2. Every headline MUST have a full, substantive summary - NEVER skip summaries.
3. Return ONLY valid JSON. No markdown, no code blocks.`;

  try {
    console.log(`[generateWeeklyReport] Generating ${type} report...`);
    
    // Use GPT-4o directly (Gemini and Claude unavailable with current API keys)
    const aiResponse = await generateReportWithFallback(prompt, ["gpt"]);
    console.log(`[generateWeeklyReport] Using provider: ${aiResponse.provider}`);
    
    const parsed = parseJSONResponse<WeeklyReport>(aiResponse);
    
    if (!parsed.headlines || parsed.headlines.length === 0) {
      throw new Error("No headlines in response");
    }
    
    if (!parsed.analysis) {
      throw new Error("No analysis in response");
    }

    // Validate all headlines have proper summaries
    function countWords(text: string): number {
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    const invalidHeadlines: string[] = [];
    let hasInsufficientDetail = false;
    for (let i = 0; i < parsed.headlines.length; i++) {
      const headline = parsed.headlines[i];
      const summaryWords = countWords(headline.summary || "");
      
      if (!headline.summary || summaryWords < 280) {
        invalidHeadlines.push(`Headline ${i + 1} "${headline.title}": ${summaryWords} words`);
        console.warn(`[generateWeeklyReport] ⚠️  Short summary for headline ${i + 1}: "${headline.title}" - only ${summaryWords} words`);
        hasInsufficientDetail = true;
      }
    }
    
    if (hasInsufficientDetail) {
      const issues = invalidHeadlines.join("\n");
      console.warn(`[generateWeeklyReport] ⚠️  Found ${invalidHeadlines.length} headlines with insufficient detail:\n${issues}`);
      // Add disclaimer to the analysis
      parsed.analysis.overallSummary += "\n\n⚠️ **DISCLAIMER**: Some headlines in this report contain insufficient context. For complete analysis, refer to the detailed summaries or original sources.";
    }

    console.log(`[generateWeeklyReport] ✓ Successfully generated ${parsed.headlines.length} headlines for ${reportTitle}`);
    return parsed;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[generateWeeklyReport] ✗ Failed to generate ${reportTitle}:`, errorMsg);
    throw new Error(`Failed to generate report: ${errorMsg}`);
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
    const OpenAI = (await import('openai')).default;
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    
    // Try Claude first, then GPT
    try {
      console.log("[generateInstagramCaption] Trying Claude...");
      const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
      const response = await claude.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2200,
        messages: [{
          role: "user",
          content: prompt,
        }],
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
        messages: [{
          role: "system",
          content: "You are an expert social media strategist. Create viral Instagram captions.",
        }, {
          role: "user",
          content: prompt,
        }],
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
