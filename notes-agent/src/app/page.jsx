'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPE_META = {
  react:     { label: 'React Component',     color: '#61dafb' },
  fullstack: { label: 'Full-Stack App',       color: '#22cc88' },
  trading:   { label: 'Trading Bot / Python', color: '#ffaa00' },
  dashboard: { label: 'Data Dashboard',       color: '#a78bfa' },
  unknown:   { label: 'General Build',        color: '#888'    },
};

const LOG_STYLE = {
  info:    { color: '#555',    icon: '›' },
  success: { color: '#22cc88', icon: '✓' },
  warn:    { color: '#ffaa00', icon: '⚠' },
  error:   { color: '#ff4444', icon: '✗' },
  ai:      { color: '#a78bfa', icon: '◆' },
  cmd:     { color: '#61dafb', icon: '$' },
};

// ── Tiny sub-components ────────────────────────────────────────────────────────

function Badge({ label, color }) {
  return (
    <span style={{
      background: color + '18', border: `1px solid ${color}44`,
      color, fontSize: 10, padding: '2px 8px', borderRadius: 2, letterSpacing: 0.5,
    }}>{label}</span>
  );
}

function CopyBtn({ text, label = 'COPY' }) {
  const [copied, setCopied] = useState(false);
  const go = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={go} style={{
      background: copied ? '#22cc8818' : '#111',
      border: `1px solid ${copied ? '#22cc88' : '#2a2a2a'}`,
      color: copied ? '#22cc88' : '#555', fontSize: 10,
      padding: '3px 10px', cursor: 'pointer', borderRadius: 2, transition: 'all .2s',
    }}>{copied ? '✓ COPIED' : label}</button>
  );
}

function LogLine({ entry }) {
  const s = LOG_STYLE[entry.type] || LOG_STYLE.info;
  return (
    <div className="fade-in" style={{ display: 'flex', gap: 10, padding: '2px 0', fontSize: 11 }}>
      <span style={{ color: '#2a2a2a', minWidth: 78 }}>{entry.time}</span>
      <span style={{ color: s.color, minWidth: 12 }}>{s.icon}</span>
      <span style={{
        color: entry.type === 'cmd' ? '#61dafb' : entry.type === 'error' ? '#ff6666' : '#999',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1,
      }}>{entry.text}</span>
    </div>
  );
}

function SectionHeader({ label, right }) {
  return (
    <div style={{
      padding: '8px 16px', borderBottom: '1px solid #111',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span style={{ fontSize: 10, color: '#444', letterSpacing: 1 }}>{label}</span>
      {right}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Home() {
  const [notes, setNotes]         = useState('');
  const [phase, setPhase]         = useState('idle');
  const [log, setLog]             = useState([]);
  const [parsed, setParsed]       = useState(null);
  const [command, setCommand]     = useState('');
  const [code, setCode]           = useState('');
  const [codeStream, setCodeStr]  = useState('');
  const [execOut, setExecOut]     = useState('');
  const [execRunning, setExecRun] = useState(false);
  const [cwdInput, setCwdInput]   = useState('~/projects');
  const [activeTab, setActiveTab] = useState('code'); // 'code' | 'exec'
  const logRef  = useRef(null);
  const abortRef = useRef(null);

  const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });
  const addLog = useCallback((type, text) => {
    setLog(l => [...l, { type, text, time: now() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const reset = () => {
    abortRef.current?.abort();
    setPhase('idle'); setLog([]); setParsed(null);
    setCommand(''); setCode(''); setCodeStr(''); setExecOut('');
  };

  const runAgent = async () => {
    if (!notes.trim() || phase === 'parsing' || phase === 'generating') return;
    reset();
    setPhase('parsing');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
        signal: ctrl.signal,
      });

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const lines = part.split('\n');
          const eventLine = lines.find(l => l.startsWith('event: '));
          const dataLine  = lines.find(l => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          const data  = JSON.parse(dataLine.slice(5));

          if (event === 'log')          addLog(data.type, data.text);
          else if (event === 'phase')   setPhase(data.phase);
          else if (event === 'parsed')  setParsed(data);
          else if (event === 'command') setCommand(data.cmd);
          else if (event === 'code_stream') setCodeStr(data.text);
          else if (event === 'parse_stream') { /* live parse JSON — ignore visual */ }
        }
      }

      // finalize code
      setCodeStr(s => { setCode(s); return ''; });

    } catch (err) {
      if (err.name !== 'AbortError') {
        addLog('error', `Network error: ${err.message}`);
        setPhase('error');
      }
    }
  };

  const executeCmd = async () => {
    if (!command || execRunning) return;
    setExecRun(true);
    setExecOut('');
    setActiveTab('exec');
    addLog('info', `Executing in: ${cwdInput}`);
    addLog('cmd', command);

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: command, cwd: cwdInput }),
      });
      const data = await res.json();
      if (data.success) {
        setExecOut(data.stdout || '(no output)');
        addLog('success', 'Claude Code execution complete.');
      } else {
        setExecOut(`ERROR:\n${data.error}\n\nSTDERR:\n${data.stderr}`);
        addLog('error', `Execution failed: ${data.error}`);
      }
    } catch (err) {
      addLog('error', `Exec request failed: ${err.message}`);
    }
    setExecRun(false);
  };

  const meta     = TYPE_META[parsed?.projectType] || TYPE_META.unknown;
  const busy     = phase === 'parsing' || phase === 'generating';
  const dotColor = { idle: '#2a2a2a', parsing: '#ffaa00', generating: '#a78bfa', done: '#22cc88', error: '#ff4444' }[phase] || '#555';
  const displayCode = codeStream || code;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#050505' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#080808', borderBottom: '1px solid #161616',
        padding: '0 20px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 44, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>
            ⬡ NOTES → CLAUDE CODE
          </span>
          <span style={{ color: '#1e1e1e' }}>│</span>
          <span style={{ fontSize: 10, color: '#333' }}>Build Agent v1.0</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {parsed && <Badge label={meta.label} color={meta.color} />}
          <div style={{
            width: 7, height: 7, borderRadius: '50%', background: dotColor,
            boxShadow: busy ? `0 0 8px ${dotColor}` : 'none',
            animation: busy ? 'pulse 1s infinite' : 'none',
          }} />
          <span style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 1 }}>{phase}</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, minHeight: 0 }}>

        {/* ══ LEFT: Notes input ══════════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #111' }}>
          <SectionHeader
            label="◎ PASTE YOUR NOTES"
            right={<span style={{ fontSize: 10, color: '#2a2a2a' }}>{notes.length} chars</span>}
          />

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={busy}
            placeholder={[
              'Paste your raw build notes here. Examples:',
              '',
              '— "Build a React trading dashboard. Live P&L chart, position tracker,',
              '   VIX gauge, sector heatmap. Recharts + Tailwind. Dark terminal theme."',
              '',
              '— "Python trading bot. RSI + MACD signals, Alpaca API, paper mode,',
              '   CSV logging, Telegram alert on entry/exit."',
              '',
              '— "Full-stack: Next.js + Postgres. User auth, subscription tiers,',
              '   Stripe integration, admin panel, REST API."',
            ].join('\n')}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: '#ccc', fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12, padding: '16px', resize: 'none', outline: 'none',
              lineHeight: 1.75, opacity: busy ? 0.4 : 1, transition: 'opacity .3s',
            }}
          />

          {/* Execute dir */}
          {command && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid #111', background: '#080808' }}>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 6 }}>OUTPUT DIRECTORY</div>
              <input
                value={cwdInput}
                onChange={e => setCwdInput(e.target.value)}
                style={{
                  width: '100%', background: '#0d0d0d', border: '1px solid #1e1e1e',
                  color: '#aaa', fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11, padding: '6px 10px', borderRadius: 2, outline: 'none',
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #111', display: 'flex', gap: 8 }}>
            <button
              onClick={runAgent}
              disabled={!notes.trim() || busy}
              style={{
                flex: 1, padding: '10px',
                background: !notes.trim() || busy ? '#0d0d0d' : '#22cc8818',
                border: `1px solid ${!notes.trim() || busy ? '#1a1a1a' : '#22cc88'}`,
                color: !notes.trim() || busy ? '#333' : '#22cc88',
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                fontWeight: 700, letterSpacing: 1, cursor: busy ? 'wait' : !notes.trim() ? 'not-allowed' : 'pointer',
                borderRadius: 2, transition: 'all .2s',
              }}
            >
              {phase === 'parsing' ? '◆ PARSING...' : phase === 'generating' ? '◆ GENERATING...' : '▶ RUN AGENT'}
            </button>

            {command && !busy && (
              <button
                onClick={executeCmd}
                disabled={execRunning}
                style={{
                  flex: 1, padding: '10px',
                  background: execRunning ? '#0d0d0d' : '#61dafb18',
                  border: `1px solid ${execRunning ? '#1a1a1a' : '#61dafb'}`,
                  color: execRunning ? '#333' : '#61dafb',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                  fontWeight: 700, letterSpacing: 1,
                  cursor: execRunning ? 'wait' : 'pointer', borderRadius: 2, transition: 'all .2s',
                }}
              >
                {execRunning ? '◆ RUNNING...' : '⚡ EXECUTE'}
              </button>
            )}

            {(phase === 'done' || phase === 'error') && (
              <button onClick={reset} style={{
                padding: '10px 14px', background: '#0d0d0d',
                border: '1px solid #1e1e1e', color: '#444',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12, cursor: 'pointer', borderRadius: 2,
              }}>↺</button>
            )}
          </div>
        </div>

        {/* ══ RIGHT: Output ══════════════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Agent log */}
          <SectionHeader label="◈ AGENT LOG" />
          <div ref={logRef} style={{
            height: 190, overflowY: 'auto', padding: '10px 16px',
            borderBottom: '1px solid #111', background: '#070707', flexShrink: 0,
          }}>
            {log.length === 0
              ? <span style={{ color: '#222', fontSize: 11 }}>Waiting for notes...</span>
              : log.map((e, i) => <LogLine key={i} entry={e} />)
            }
          </div>

          {/* Parsed plan */}
          {parsed && (
            <div className="fade-in" style={{
              padding: '10px 16px', borderBottom: '1px solid #111',
              background: '#080808', flexShrink: 0,
            }}>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 8 }}>◦ BUILD PLAN</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {parsed.stack?.map(s => <Badge key={s} label={s} color={meta.color} />)}
              </div>
              <div style={{ fontSize: 11, color: '#777', marginBottom: 6 }}>{parsed.summary}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {parsed.features?.map((f, i) => (
                  <span key={i} style={{ fontSize: 10, color: '#3a3a3a' }}>› {f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Claude Code command */}
          {command && (
            <div className="fade-in" style={{
              padding: '10px 16px', borderBottom: '1px solid #111',
              background: '#060606', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                <span style={{ fontSize: 10, color: '#444' }}>$ CLAUDE CODE COMMAND</span>
                <CopyBtn text={command} />
              </div>
              <div style={{
                background: '#0a0a0a', border: '1px solid #1a1a1a',
                borderLeft: `3px solid #61dafb`, padding: '8px 12px',
                fontSize: 11, color: '#61dafb', wordBreak: 'break-all', borderRadius: 2,
              }}>{command}</div>
            </div>
          )}

          {/* Code / Exec tabs */}
          {(displayCode || execOut) && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #111', flexShrink: 0 }}>
                {[
                  { key: 'code', label: `◧ STARTER CODE${parsed?.entryPoint ? ` — ${parsed.entryPoint}` : ''}` },
                  { key: 'exec', label: '⚡ EXEC OUTPUT' },
                ].map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                    padding: '8px 16px', fontSize: 10, letterSpacing: 1,
                    background: 'transparent', border: 'none',
                    borderBottom: activeTab === tab.key ? '2px solid #22cc88' : '2px solid transparent',
                    color: activeTab === tab.key ? '#22cc88' : '#333',
                    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
                  }}>{tab.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                {activeTab === 'code' && displayCode && <div style={{ padding: '6px 12px' }}><CopyBtn text={displayCode} /></div>}
              </div>

              <div style={{
                flex: 1, overflowY: 'auto', padding: '12px 16px',
                background: '#070707', fontSize: 11, color: '#888',
                whiteSpace: 'pre-wrap', fontFamily: "'IBM Plex Mono', monospace",
                lineHeight: 1.65,
              }}>
                {activeTab === 'code' && (
                  <>
                    {displayCode}
                    {busy && codeStream && (
                      <span style={{ color: '#a78bfa', animation: 'blink 1s infinite' }}>█</span>
                    )}
                  </>
                )}
                {activeTab === 'exec' && (
                  execOut
                    ? <span style={{ color: execOut.startsWith('ERROR') ? '#ff6666' : '#aaa' }}>{execOut}</span>
                    : <span style={{ color: '#2a2a2a' }}>No output yet. Hit ⚡ EXECUTE to run.</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
