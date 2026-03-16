import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";

export interface AIResponse {
  content: string;
  provider: "gemini" | "gpt" | "claude";
  model: string;
}

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
export async function generateReportWithFallback(
  prompt: string,
  providers: Array<"gemini" | "claude" | "gpt"> = ["gemini", "claude", "gpt"]
): Promise<AIResponse> {
  const errors: Array<{ provider: string; error: string }> = [];
  const rateLimitErrors: string[] = [];

  for (const provider of providers) {
    try {
      console.log(`[AI Service] Attempting ${provider}...`);

      let response: AIResponse;
      if (provider === "gemini") {
        response = await generateWithGemini(prompt);
      } else if (provider === "claude") {
        response = await generateWithClaude(prompt);
      } else if (provider === "gpt") {
        response = await generateWithGPT(prompt);
      } else {
        continue;
      }

      console.log(`[AI Service] ✓ ${provider} succeeded (got response)`);
      
      // Try to parse JSON - if it fails, treat as recoverable error and try next provider
      try {
        parseJSONResponse(response);
        console.log(`[AI Service] ✓ ${provider} JSON parsed successfully`);
        return response;
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[AI Service] ${provider} JSON parse failed: ${parseMsg}`);
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
  const modelsToTry = ["gemini-pro", "gemini-1.5-pro", "gemini-2.0-flash"];
  
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

      return {
        content,
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

async function generateWithClaude(prompt: string): Promise<AIResponse> {
  const client = getAnthropic();

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    system: "You are a professional analyst. Return ONLY valid JSON with no additional text or markdown.",
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  if (!content) throw new Error("Empty response from Claude");

  return {
    content,
    provider: "claude",
    model: "claude-3-5-sonnet-20241022",
  };
}

async function generateWithGPT(prompt: string): Promise<AIResponse> {
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
    max_tokens: 16000, // GPT-4o max completion tokens is 16384
  });

  const content = response.choices[0].message.content || "";
  if (!content) throw new Error("Empty response from GPT");

  console.log(`[generateWithGPT] Raw response (first 300 chars):`, content.substring(0, 300));
  console.log(`[generateWithGPT] Raw response (last 300 chars):`, content.substring(Math.max(0, content.length - 300)));
  console.log(`[generateWithGPT] Total length: ${content.length}, finish_reason: ${response.choices[0].finish_reason}`);
  
  // Check if response was truncated
  if (response.choices[0].finish_reason === "length") {
    console.warn("[generateWithGPT] WARNING: Response was truncated due to token limit");
    throw new Error("GPT response truncated - token limit reached. Response is incomplete.");
  }

  return {
    content,
    provider: "gpt",
    model: "gpt-4o",
  };
}

/**
 * Parse JSON response from any provider with robust error recovery
 */
export function parseJSONResponse<T>(response: AIResponse): T {
  try {
    let jsonText = response.content.trim();
    
    console.log(`[parseJSONResponse] Raw content length: ${jsonText.length}, first 200 chars:`, jsonText.substring(0, 200));
    
    // Step 1: Remove markdown code blocks
    jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    jsonText = jsonText.trim();
    
    // Step 2: Try parsing directly
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      console.log("[parseJSONResponse] Direct parse failed");
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
      console.log(`[parseJSONResponse] Balance at end: ${balance}, last 100 chars:`, jsonText.substring(Math.max(0, jsonText.length - 100)));
      throw new Error("Mismatched JSON brackets - no closing bracket found");
    }
    
    let extracted = jsonText.substring(jsonStart, jsonEnd);
    console.log(`[parseJSONResponse] Extracted ${extracted.length} chars, first 150:`, extracted.substring(0, 150));
    console.log(`[parseJSONResponse] Last 150 of extracted:`, extracted.substring(Math.max(0, extracted.length - 150)));
    
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
      console.log("[parseJSONResponse] Parse failed after newline fix");
    }
    
    // Step 6: Remove trailing commas
    fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
    
    try {
      return JSON.parse(fixed);
    } catch (e) {
      console.log("[parseJSONResponse] Parse failed after comma fix");
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
