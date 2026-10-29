/** A tiny bar chart of hourly counts, oldest first. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const width = values.length * 4;
  return (
    <svg
      viewBox={`0 0 ${width} 20`}
      width={width}
      height={20}
      role="img"
      aria-label={`${label}: ${total} requests in the last 24 hours`}
      className="text-primary"
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * 20);
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per hour, fixed order
            key={i}
            x={i * 4}
            y={20 - h}
            width={3}
            height={h}
            rx={0.5}
            fill="currentColor"
            opacity={v === 0 ? 0.2 : 0.85}
          />
        );
      })}
    </svg>
  );
}
