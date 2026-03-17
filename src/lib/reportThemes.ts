export const REPORT_COLORS: Record<string, { hex: string; rgb: string }> = {
  global:       { hex: '#60a5fa', rgb: '96,165,250' },
  crypto:       { hex: '#f7931a', rgb: '247,147,26' },
  equities:     { hex: '#4ade80', rgb: '74,222,128' },
  nasdaq:       { hex: '#c084fc', rgb: '192,132,252' },
  conspiracies: { hex: '#f87171', rgb: '248,113,113' },
  forecast:     { hex: '#facc15', rgb: '250,204,21' },
  custom:       { hex: '#2dd4bf', rgb: '45,212,191' },
  china:        { hex: '#ef4444', rgb: '239,68,68' },
};

export const getReportColor = (type?: string) =>
  REPORT_COLORS[type ?? 'crypto'] ?? REPORT_COLORS.crypto;

export const makeTheme = (hex: string, rgb: string) => ({
  hex,
  border:      `rgba(${rgb},0.30)`,
  borderLight: `rgba(${rgb},0.15)`,
  bg:          `rgba(${rgb},0.05)`,
  bgMed:       `rgba(${rgb},0.10)`,
  text:         hex,
  textMuted:   `rgba(${rgb},0.60)`,
  textFaint:   `rgba(${rgb},0.40)`,
  glow:        `0 0 20px rgba(${rgb},0.12)`,
  glowMd:      `0 0 30px rgba(${rgb},0.18)`,
  glowLg:      `0 0 50px rgba(${rgb},0.22)`,
  gradLine:    `linear-gradient(to right, transparent, ${hex}99, transparent)`,
  pill:        { backgroundColor: `rgba(${rgb},0.10)`, borderColor: `rgba(${rgb},0.25)`, color: hex },
});
