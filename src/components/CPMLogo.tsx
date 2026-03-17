import React from 'react';

export const CPMLogo = ({ size = 32, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {[8,16,24,32,40].flatMap(x => [8,16,24,32,40].map(y =>
      <circle key={`${x}-${y}`} cx={x} cy={y} r="0.7" fill="#f7931a" opacity="0.18" />
    ))}
    <rect x="3" y="3" width="42" height="42" stroke="#f7931a" strokeWidth="0.8" opacity="0.25" />
    <polyline points="3,13 3,3 13,3" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="35,3 45,3 45,13" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="45,35 45,45 35,45" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="13,45 3,45 3,35" stroke="#f7931a" strokeWidth="2" fill="none" />
    <line x1="8" y1="36" x2="40" y2="36" stroke="#f7931a" strokeWidth="1" opacity="0.35" />
    <polyline points="8,32 14,28 19,30 24,20 30,23 36,15 40,13"
      stroke="#f7931a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <polyline points="34,10 40,13 37,19" stroke="#f7931a" strokeWidth="2" strokeLinecap="round" fill="none" />
    <line x1="18" y1="13" x2="18" y2="37" stroke="#f7931a" strokeWidth="1" opacity="0.3" />
    <line x1="30" y1="13" x2="30" y2="37" stroke="#f7931a" strokeWidth="1" opacity="0.3" />
  </svg>
);

export const CPMLogoImg = ({ size = 32, style = {} }: { size?: number; style?: React.CSSProperties }) => {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="42" height="42" stroke="%23f7931a" stroke-width="0.8" opacity="0.25"/><polyline points="3,13 3,3 13,3" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="35,3 45,3 45,13" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="45,35 45,45 35,45" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="13,45 3,45 3,35" stroke="%23f7931a" stroke-width="2" fill="none"/><line x1="8" y1="36" x2="40" y2="36" stroke="%23f7931a" stroke-width="1" opacity="0.35"/><polyline points="8,32 14,28 19,30 24,20 30,23 36,15 40,13" stroke="%23f7931a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><polyline points="34,10 40,13 37,19" stroke="%23f7931a" stroke-width="2" stroke-linecap="round" fill="none"/><line x1="18" y1="13" x2="18" y2="37" stroke="%23f7931a" stroke-width="1" opacity="0.3"/><line x1="30" y1="13" x2="30" y2="37" stroke="%23f7931a" stroke-width="1" opacity="0.3"/></svg>`;
  return <img src={`data:image/svg+xml,${svg}`} width={size} height={size} style={{ display: 'block', ...style }} />;
};
