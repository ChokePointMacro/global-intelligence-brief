# Notes → Claude Code Agent

Paste raw project notes → Claude parses them → generates a Claude Code CLI command → executes the build.

## Setup (3 steps)

### 1. Install dependencies
```bash
npm install
```

### 2. Add your Anthropic API key
Edit `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
Get your key at https://console.anthropic.com

### 3. Run
```bash
npm run dev
```
Open http://localhost:3000

---

## How it works

1. **Paste notes** — raw text, bullets, stream of consciousness
2. **▶ RUN AGENT** — Claude parses your notes into a structured build plan
3. **Claude Code command** is generated and displayed (copy it anytime)
4. **Starter code** is streamed live in the right panel
5. **Set output directory** — where Claude Code will write files
6. **⚡ EXECUTE** — runs `claude "..."` in your terminal via the local API route

## Requirements

- Node.js 18+
- `claude` CLI installed globally (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key

## Project types supported

| Type | Detection keywords |
|------|--------------------|
| React Component | react, component, ui, frontend, page |
| Full-Stack App | fullstack, backend, api, database |
| Trading Bot | trading, bot, python, strategy, backtest |
| Data Dashboard | dashboard, chart, metrics, analytics |
