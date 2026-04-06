interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 56, height = 20, color }: Props) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const allZero = data.every(v => v === 0);

  if (allZero) {
    const mid = height / 2;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} y1={mid} x2={width} y2={mid}
          stroke="#888780" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }

  const pad = 2;
  const usable = height - pad * 2;
  const step = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data
    .map((v, i) => `${i * step},${height - (v / max) * usable - pad}`)
    .join(' ');

  let stroke = color;
  if (!stroke) {
    const last3 = data.slice(-3).reduce((a, b) => a + b, 0);
    const first3 = data.slice(0, 3).reduce((a, b) => a + b, 0);
    if (last3 > first3) stroke = '#1D9E75';
    else if (last3 < first3) stroke = '#E24B4A';
    else stroke = '#888780';
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={stroke}
        strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
