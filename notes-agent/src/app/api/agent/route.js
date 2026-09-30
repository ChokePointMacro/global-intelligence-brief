import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARSE_SYSTEM = `You are a senior software architect. Extract structured build instructions from a developer's raw notes.
Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "projectName": "short-kebab-case-name",
  "projectType": "react|fullstack|trading|dashboard|unknown",
  "summary": "one sentence description",
  "stack": ["list", "of", "technologies"],
  "features": ["feature 1", "feature 2"],
  "entryPoint": "the main file to create first e.g. src/App.jsx or main.py",
  "claudeCodePrompt": "A precise, detailed natural-language prompt to pass to Claude Code CLI. Include stack, file names, features, patterns, and folder structure. Be exhaustive."
}`;

const CODE_SYSTEM = `You are an expert developer. Generate a complete, production-ready starter file for the project described.
- React/Next.js: return a full .jsx/.tsx component with all imports and placeholder logic
- Python/trading: return a well-structured .py file with class structure, logging, and TODO comments
- Full-stack: return the main entry file with route stubs and DB connection placeholders
Include helpful TODO comments where live data or secrets would be wired in.
Return ONLY the raw code. No markdown fences, no explanation.`;

export async function POST(req) {
  const { notes } = await req.json();

  if (!notes?.trim()) {
    return new Response(JSON.stringify({ error: 'No notes provided' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // ── Phase 1: Parse notes ──────────────────────────────────────────
        send('log', { type: 'info', text: 'Agent started — ingesting notes...' });
        send('log', { type: 'info', text: `Notes: ${notes.length} characters received` });
        send('log', { type: 'ai', text: 'Sending to Claude API → extracting build plan...' });
        send('phase', { phase: 'parsing' });

        let rawParse = '';
        const parseStream = await client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: PARSE_SYSTEM,
          messages: [{ role: 'user', content: `Here are my notes:\n\n${notes}` }],
        });

        for await (const chunk of parseStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
            rawParse += chunk.delta.text;
            send('parse_stream', { text: rawParse });
          }
        }

        let parsed;
        try {
          const clean = rawParse.replace(/```json|```/g, '').trim();
          parsed = JSON.parse(clean);
        } catch {
          send('log', { type: 'error', text: 'Failed to parse JSON from Claude. Try adding more detail to your notes.' });
          send('phase', { phase: 'error' });
          controller.close();
          return;
        }

        send('parsed', parsed);
        send('log', { type: 'success', text: `Project: "${parsed.projectName}"` });
        send('log', { type: 'success', text: `Type detected: ${parsed.projectType}` });
        send('log', { type: 'info', text: `Stack: ${parsed.stack?.join(', ')}` });
        send('log', { type: 'info', text: `${parsed.features?.length} features extracted` });

        // ── Phase 2: Build Claude Code command ────────────────────────────
        send('phase', { phase: 'generating' });
        send('log', { type: 'ai', text: 'Building Claude Code CLI command...' });

        const escapedPrompt = parsed.claudeCodePrompt.replace(/"/g, '\\"');
        const cmd = `claude "${escapedPrompt}"`;
        send('command', { cmd });
        send('log', { type: 'cmd', text: cmd });

        // ── Phase 3: Generate starter code ───────────────────────────────
        send('log', { type: 'ai', text: `Generating starter code → ${parsed.entryPoint}` });

        let code = '';
        const codeStream = await client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: CODE_SYSTEM,
          messages: [{
            role: 'user',
            content: `Project: ${parsed.summary}\nStack: ${parsed.stack?.join(', ')}\nFeatures: ${parsed.features?.join(', ')}\nEntry point file: ${parsed.entryPoint}`,
          }],
        });

        for await (const chunk of codeStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
            code += chunk.delta.text;
            send('code_stream', { text: code });
          }
        }

        send('log', { type: 'success', text: `Starter code generated (${code.length} chars)` });
        send('log', { type: 'success', text: '✓ Agent complete — copy the command and run it in your terminal.' });
        send('phase', { phase: 'done' });

      } catch (err) {
        send('log', { type: 'error', text: `Agent error: ${err.message}` });
        send('phase', { phase: 'error' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
