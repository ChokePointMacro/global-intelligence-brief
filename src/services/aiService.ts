import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export interface AIResponse {
  content: string;
  provider: "gemini" | "gpt" | "claude";
  model: string;
  warnings?: string[];
  /** Token usage for this call. Previously captured into the module-level rateLimits
   *  object and discarded, which made per-call AI spend impossible to attribute. */
  inputTokens?: number;
  outputTokens?: number;
}

// Rate limit snapshots captured from API responses
export interface RateLimitData {
  limitRequests?: number;
  limitTokens?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequests?: string;
  resetTokens?: string;
  inputTokensUsed?: number;
  outputTokensUsed?: number;
  lastCallAt?: string;
  lastModel?: string;
}

export const rateLimits: Record<string, RateLimitData> = {
  anthropic: {},
  gemini: {},
};

export interface ReportRequest {
  type: "global" | "crypto" | "equities" | "conspiracies";
  topicFocus: string;
  reportTitle: string;
}

// Initialize providers
function getGeminiAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
}

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
}

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
}

/**
 * Generate content using multi-provider AI with automatic fallback
 * Tries providers in order: Gemini → Claude → GPT
 * Also retries with different providers if JSON parsing fails
 */

/**
 * Spend hook. aiService has no database access by design, so the server registers a
 * listener and every completed AI call reports its token usage through it. Without this
 * the AI half of the bill — usually the larger half — is invisible.
 */
export type AISpendListener = (info: { provider: string; model: string; inputTokens: number; outputTokens: number; label: string }) => void;
let spendListener: AISpendListener | null = null;
export function onAISpend(fn: AISpendListener | null): void { spendListener = fn; }

/** Report spend for an AI call made outside generateReportWithFallback (direct SDK use). */
export function reportAISpend(info: { provider: string; model: string; inputTokens: number; outputTokens: number; label: string }): void {
  try { spendListener?.(info); } catch { /* accounting must never break generation */ }
}

/**
 * Pre-flight budget gate — the enforcement half of the spend story.
 *
 * The ledger above *measures* spend; nothing stopped it. A runaway generation loop or a
 * stuck retry would bill without limit and the only evidence would be a larger number in
 * the spend UI afterwards. This lets the server veto a call before it is made.
 *
 * Same injection pattern as the spend listener: aiService has no database access, so the
 * server registers the policy and this module only enforces whatever it returns.
 */
export type SpendGuard = () => { allowed: boolean; reason?: string };
let spendGuard: SpendGuard | null = null;
export function setSpendGuard(fn: SpendGuard | null): void { spendGuard = fn; }

/** Thrown when a call is refused by the budget gate. Distinguishable from a provider error. */
export class SpendCapExceededError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SpendCapExceededError';
  }
}

/**
 * Throws if the configured spend cap is already exceeded.
 *
 * Call this before any billable AI request, including direct SDK use that bypasses the
 * fallback chain. A guard that throws is treated as refusing: if the policy itself is
 * broken we stop spending rather than assume consent.
 */
export function assertSpendAllowed(label = 'ai_call'): void {
  if (!spendGuard) return; // no policy registered → unmetered, as before
  let verdict: { allowed: boolean; reason?: string };
  try {
    verdict = spendGuard();
  } catch (err) {
    throw new SpendCapExceededError(
      `spend guard failed, refusing to spend (${label}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!verdict.allowed) {
    throw new SpendCapExceededError(verdict.reason || `spend cap reached, refusing ${label}`);
  }
}


/**
 * Fallback chain for PROSE output (articles, captions).
 *
 * generateReportWithFallback validates every response with parseJSONResponse, so callers
 * that want prose could not use it — they called the Anthropic SDK directly instead, which
 * meant no provider fallback (Claude down = feature dead) and no spend metering.
 */
export async function generateTextWithFallback(
  prompt: string,
  providers: Array<"gemini" | "claude" | "gpt"> = ["claude", "gpt"],
  maxTokens = 4000,
  label = 'text_call',
  system?: string
): Promise<AIResponse> {
  // Checked once, before the chain: a refusal is a budget decision, not a provider
  // failure, so it must not fall through to the next provider and spend there instead.
  assertSpendAllowed(label);

  const errors: Array<{ provider: string; error: string }> = [];
  for (const provider of providers) {
    try {
      let response: AIResponse;
      if (provider === "claude") response = await generateWithClaude(prompt, maxTokens, undefined, system);
      else if (provider === "gpt") response = await generateWithGPT(prompt, maxTokens);
      else if (provider === "gemini") response = await generateWithGemini(prompt);
      else continue;

      if (!response.content?.trim()) throw new Error(`Empty response from ${provider}`);
      console.log(`[AI Service] ✓ ${provider} produced text (${response.content.length} chars)`);
      try {
        spendListener?.({ provider, model: response.model,
          inputTokens: response.inputTokens ?? 0, outputTokens: response.outputTokens ?? 0, label });
      } catch { /* accounting must never break generation */ }
      return response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[AI Service] ✗ ${provider} failed (text): ${msg}`);
      errors.push({ provider, error: msg });
    }
  }
  throw new Error(`All AI providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join(" | ")}`);
}

export async function generateReportWithFallback(
  prompt: string,
  providers: Array<"gemini" | "claude" | "gpt"> = ["claude", "gemini", "gpt"],
  maxTokens = 8000,
  label = 'ai_call',
  onTick?: TokenTickFn
): Promise<AIResponse> {
  // See generateTextWithFallback: a budget refusal must short-circuit the whole chain.
  assertSpendAllowed(label);

  const errors: Array<{ provider: string; error: string }> = [];
  const rateLimitErrors: string[] = [];

  for (const provider of providers) {
    try {
      console.log(`[AI Service] Attempting ${provider}...`);

      let response: AIResponse;
      if (provider === "gemini") {
        response = await generateWithGemini(prompt);
      } else if (provider === "claude") {
        response = await generateWithClaude(prompt, maxTokens, onTick);
      } else if (provider === "gpt") {
        response = await generateWithGPT(prompt, maxTokens);
      } else {
        continue;
      }

      console.log(`[AI Service] ✓ ${provider} succeeded (got response)`);
      
      // Try to parse JSON - if it fails, treat as recoverable error and try next provider
      try {
        parseJSONResponse(response);
        console.log(`[AI Service] ✓ ${provider} JSON parsed successfully`);
        // Report spend only on the call we actually keep. Failed attempts that fell
        // through to another provider still cost money, so they are reported too — see
        // the catch below — but tagged so they can be told apart from useful spend.
        try {
          spendListener?.({
            provider, model: response.model,
            inputTokens: response.inputTokens ?? 0,
            outputTokens: response.outputTokens ?? 0,
            label,
          });
        } catch { /* never let accounting break generation */ }
        return response;
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[AI Service] ${provider} JSON parse failed: ${parseMsg}`);
        // A discarded response was still billed. Record it separately so wasted spend
        // from provider fallbacks is visible rather than silently absorbed.
        try {
          spendListener?.({
            provider, model: response.model,
            inputTokens: response.inputTokens ?? 0,
            outputTokens: response.outputTokens ?? 0,
            label: `${label}_discarded`,
          });
        } catch { /* ignore */ }
        errors.push({ provider, error: `JSON parse failed: ${parseMsg}` });
        // Continue to next provider
        continue;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Check for rate limit errors
      if (
        errorMsg.includes("rate limit") ||
        errorMsg.includes("Rate limit") ||
        errorMsg.includes("429") ||
        errorMsg.includes("quota") ||
        errorMsg.includes("Quota")
      ) {
        const rateLimitMsg = `${provider} rate limit: ${errorMsg}`;
        rateLimitErrors.push(rateLimitMsg);
        console.error(`[AI Service] ⚠️  ${rateLimitMsg}`);
      } else {
        console.error(`[AI Service] ✗ ${provider} failed:`, errorMsg);
      }
      
      errors.push({ provider, error: errorMsg });
    }
  }

  // All providers failed - construct detailed error message
  let errorMessage = "All AI providers failed.";
  
  if (rateLimitErrors.length > 0) {
    errorMessage = `Rate limit errors: ${rateLimitErrors.join(" | ")}`;
  } else {
    const errorDetails = errors
      .map((e) => `${e.provider}: ${e.error}`)
      .join(" | ");
    errorMessage = `All AI providers failed: ${errorDetails}`;
  }
  
  throw new Error(errorMessage);
}

// Provider-specific implementations

async function generateWithGemini(prompt: string): Promise<AIResponse> {
  const ai = getGeminiAI();
  // Try available models in order of preference
  const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-pro"];
  
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }], role: "user" }],
        config: {
          systemInstruction: "You are a professional analyst. Return ONLY valid JSON with no additional text or markdown.",
          responseMimeType: "application/json",
        },
      });

      const content = response.text || "";
      if (!content) throw new Error("Empty response from Gemini");

      // Capture Gemini usage data
      rateLimits.gemini = {
        inputTokensUsed: (response as any).usageMetadata?.promptTokenCount,
        outputTokensUsed: (response as any).usageMetadata?.candidatesTokenCount,
        lastCallAt: new Date().toISOString(),
        lastModel: model,
      };

      return {
        content,
        inputTokens: (response as any).usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (response as any).usageMetadata?.candidatesTokenCount ?? 0,
        provider: "gemini",
        model,
      };
    } catch (error) {
      console.warn(`[AI Service] Gemini model ${model} failed, trying next...`);
      if (model === modelsToTry[modelsToTry.length - 1]) {
        // Last model failed, re-throw
        throw error;
      }
    }
  }

  throw new Error("No available Gemini models");
}

/** Reports output tokens generated so far, for progress UI. */
export type TokenTickFn = (outputTokensSoFar: number, maxTokens: number) => void;

async function generateWithClaude(prompt: string, maxTokens = 8000, onTick?: TokenTickFn, system?: string): Promise<AIResponse> {
  const client = getAnthropic();

  // Streamed, not a single blocking create(). Two reasons:
  //  1. maxTokens is 16k for reports — at that size a non-streaming request risks an
  //     SDK HTTP timeout, and the whole generation is lost.
  //  2. A blocking call is a black box, so the UI had nothing to report for ~3.5
  //     minutes and looked hung. Streaming gives real token-level progress.
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    system: system ?? "You are a professional analyst. Return ONLY valid JSON with no additional text or markdown.",
  });

  if (onTick) {
    let seen = 0;
    let lastReport = 0;
    stream.on('text', (delta: string) => {
      // ~4 chars per token is close enough to drive a progress bar; the authoritative
      // count comes from usage on the final message.
      seen += delta.length / 4;
      const now = Date.now();
      if (now - lastReport > 700) { lastReport = now; onTick(seen, maxTokens); }
    });
  }

  const response = await stream.finalMessage();
  // MessageStream exposes the underlying Response, so rate-limit headers survive the
  // switch to streaming — the Connections page keeps its data.
  const raw = (stream.response ?? { headers: { get: () => null } }) as any;

  // Capture rate limit headers
  rateLimits.anthropic = {
    limitRequests: parseInt(raw.headers.get('x-ratelimit-limit-requests') || '') || undefined,
    limitTokens: parseInt(raw.headers.get('x-ratelimit-limit-tokens') || '') || undefined,
    remainingRequests: parseInt(raw.headers.get('x-ratelimit-remaining-requests') || '') || undefined,
    remainingTokens: parseInt(raw.headers.get('x-ratelimit-remaining-tokens') || '') || undefined,
    resetRequests: raw.headers.get('x-ratelimit-reset-requests') || undefined,
    resetTokens: raw.headers.get('x-ratelimit-reset-tokens') || undefined,
    inputTokensUsed: response.usage?.input_tokens,
    outputTokensUsed: response.usage?.output_tokens,
    lastCallAt: new Date().toISOString(),
    lastModel: "claude-sonnet-4-6",
  };

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  if (!content) throw new Error("Empty response from Claude");

  const warnings: string[] = [];
  if (response.stop_reason === "max_tokens") {
    console.warn("[generateWithClaude] WARNING: Response truncated at max_tokens limit — attempting salvage");
    warnings.push("Claude response was truncated at token limit. Some headlines or analysis may be missing.");
  }

  return {
    content,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    provider: "claude",
    model: "claude-sonnet-4-6",
    warnings: warnings.length ? warnings : undefined,
  };
}

async function generateWithGPT(prompt: string, maxTokens = 8000): Promise<AIResponse> {
  const client = getOpenAI();

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a professional analyst. Return ONLY valid JSON - no markdown, no backticks, no explanations. Start with { and end with }. Do not wrap in code blocks or add any text before or after the JSON.",
      },
      {
        role: "user",
        content: prompt + "\n\nRETURN ONLY JSON - NO MARKDOWN - NO CODE BLOCKS - START WITH { AND END WITH }",
      },
    ],
    max_tokens: Math.min(maxTokens, 16000), // GPT-4o max completion tokens is 16384
  });

  const content = response.choices[0].message.content || "";
  if (!content) throw new Error("Empty response from GPT");

  const warnings: string[] = [];
  if (response.choices[0].finish_reason === "length") {
    console.warn("[generateWithGPT] WARNING: Response truncated — attempting salvage");
    warnings.push("GPT response was truncated at token limit. Some headlines or analysis may be missing.");
  }

  return {
    content,
    inputTokens: (response as any).usage?.prompt_tokens ?? 0,
    outputTokens: (response as any).usage?.completion_tokens ?? 0,
    provider: "gpt",
    model: "gpt-4o",
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * Parse JSON response from any provider with robust error recovery
 */
export function parseJSONResponse<T>(response: AIResponse): T {
  try {
    let jsonText = response.content.trim();
    
    // Step 1: Remove markdown code blocks
    jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    jsonText = jsonText.trim();
    
    // Step 2: Try parsing directly
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      // Silently fail direct parse, fall through to extraction
    }
    
    // Step 3: Simple extraction - find first { or [ and last } or ]
    let jsonStart = -1;
    let jsonEnd = -1;
    
    // Find start
    const firstBrace = jsonText.indexOf("{");
    const firstBracket = jsonText.indexOf("[");
    
    if (firstBrace === -1 && firstBracket === -1) {
      throw new Error("No JSON structure found in response");
    }
    
    if (firstBrace === -1) {
      jsonStart = firstBracket;
    } else if (firstBracket === -1) {
      jsonStart = firstBrace;
    } else {
      jsonStart = Math.min(firstBrace, firstBracket);
    }
    
    // Find end - work backwards looking for matching closing bracket
    let balance = 0;
    let inString = false;
    let escaped = false;
    
    for (let i = jsonStart; i < jsonText.length; i++) {
      const char = jsonText[i];
      
      if (char === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      
      if (char === '"' && !escaped) {
        inString = !inString;
        escaped = false;
        continue;
      }
      
      escaped = false;
      
      if (!inString) {
        if (char === "{" || char === "[") {
          balance++;
        } else if (char === "}" || char === "]") {
          balance--;
          if (balance === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }
    
    if (jsonEnd === -1) {
      // Truncated response — try to repair by closing open brackets
      console.warn("[parseJSON] Truncated JSON detected — attempting repair");
      let repaired = jsonText.substring(jsonStart);
      // Close any open string
      let inStr = false;
      let esc = false;
      for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '\\' && !esc) { esc = true; continue; }
        if (repaired[i] === '"' && !esc) inStr = !inStr;
        esc = false;
      }
      if (inStr) repaired += '"';
      // Remove trailing comma/incomplete value
      repaired = repaired.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
      // Close open brackets
      const stack: string[] = [];
      let inStr2 = false; let esc2 = false;
      for (const ch of repaired) {
        if (ch === '\\' && !esc2) { esc2 = true; continue; }
        if (ch === '"' && !esc2) { inStr2 = !inStr2; esc2 = false; continue; }
        esc2 = false;
        if (!inStr2) {
          if (ch === '{') stack.push('}');
          else if (ch === '[') stack.push(']');
          else if (ch === '}' || ch === ']') stack.pop();
        }
      }
      repaired += stack.reverse().join('');
      try {
        return JSON.parse(repaired);
      } catch {
        throw new Error("Truncated JSON could not be repaired");
      }
    }

    let extracted = jsonText.substring(jsonStart, jsonEnd);
    
    // Step 4: Fix unescaped newlines in string values
    let fixed = "";
    inString = false;
    escaped = false;
    
    for (let i = 0; i < extracted.length; i++) {
      const char = extracted[i];
      
      if (char === "\\" && !escaped) {
        escaped = true;
        fixed += char;
        continue;
      }
      
      if (char === '"' && !escaped) {
        inString = !inString;
        fixed += char;
        escaped = false;
        continue;
      }
      
      if ((char === "\n" || char === "\r") && inString && !escaped) {
        fixed += "\\n";
        escaped = false;
        continue;
      }
      
      fixed += char;
      escaped = false;
    }
    
    // Step 5: Try parsing with newlines fixed
    try {
      return JSON.parse(fixed);
    } catch (e) {
      // Continue to next fix strategy
    }
    
    // Step 6: Remove trailing commas
    fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
    
    try {
      return JSON.parse(fixed);
    } catch (e) {
      // Continue to next fix strategy
    }
    
    // Step 7: Final attempt - remove any non-printable/control characters except newlines
    fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    
    try {
      return JSON.parse(fixed);
    } catch (e) {
      const parseErr = e instanceof Error ? e.message : String(e);
      throw new Error(`Could not parse JSON: ${parseErr.substring(0, 100)}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`JSON parse failed from ${response.provider}: ${errorMsg}`);
  }
}
