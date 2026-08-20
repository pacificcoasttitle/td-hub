'use client';

interface Props {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** Describes the trend for screen readers — the shape alone is not accessible. */
  ariaLabel: string;
}

/**
 * Six-point trend line with a dot on the latest value. Renders nothing below
 * two points: one point is not a trend, and a flat stub would imply one.
 */
export function MiniSparkline({
  values,
  color,
  width = 86,
  height = 22,
  strokeWidth = 2,
  ariaLabel,
}: Props) {
  if (!values || values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const scaleY = (v: number) => (height - ((v - min) / span) * (height - 4) - 2).toFixed(1);

  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${scaleY(v)}`)
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="overflow-hidden block"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />
      <circle cx={width} cy={scaleY(values[values.length - 1])} r={2.8} fill={color} />
    </svg>
  );
}
