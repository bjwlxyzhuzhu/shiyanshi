import type { ChartData } from '@zhian/shared';

const COLORS = ['#1f5f8b', '#c76a00', '#17865f', '#7a4fb3'];

export function ChartView({ chart }: { chart: ChartData }) {
  const width = 640;
  const height = 210;
  const pad = { left: 44, right: 14, top: 14, bottom: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const all = chart.series.flatMap((series) => series.values);
  if (chart.threshold) all.push(chart.threshold.value);
  const maxY = Math.max(...all, 0) * 1.1 || 1;
  const minY = Math.min(0, ...all);
  const sy = (value: number) => pad.top + plotH - ((value - minY) / (maxY - minY || 1)) * plotH;
  const count = chart.x.length;
  const bars = count <= 6;
  const step = Math.max(1, Math.ceil(count / 8));

  return (
    <figure className="chart-box" style={{ margin: 0 }}>
      <h4>{chart.title}</h4>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={chart.title}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = minY + (maxY - minY) * ratio;
          const y = sy(value);
          return (
            <g key={ratio}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#e4e2da" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#7b8191">
                {value >= 10 ? value.toFixed(0) : value.toFixed(2)}
              </text>
            </g>
          );
        })}

        {bars
          ? chart.x.map((label, index) => {
            const groupW = plotW / count;
            const barW = Math.min(36, (groupW * 0.7) / chart.series.length);
            const start = pad.left + groupW * index + (groupW - barW * chart.series.length) / 2;
            return (
              <g key={String(label)}>
                {chart.series.map((series, s) => {
                  const value = series.values[index] ?? 0;
                  return (
                    <rect
                      key={series.name}
                      x={start + barW * s}
                      y={sy(value)}
                      width={barW - 3}
                      height={Math.max(0, sy(minY) - sy(value))}
                      rx={3}
                      fill={COLORS[s % COLORS.length]}
                    />
                  );
                })}
                <text x={pad.left + groupW * (index + 0.5)} y={height - 8} textAnchor="middle" fontSize="11" fill="#4a5263">
                  {String(label)}
                </text>
              </g>
            );
          })
          : chart.series.map((series, s) => {
            const sx = (index: number) => pad.left + (index / Math.max(1, count - 1)) * plotW;
            const points = series.values.map((value, index) => `${sx(index).toFixed(1)},${sy(value).toFixed(1)}`).join(' ');
            return (
              <g key={series.name}>
                <polyline points={points} fill="none" stroke={COLORS[s % COLORS.length]} strokeWidth={2.2} strokeLinejoin="round" />
                {s === 0 ? chart.x.map((label, index) => (index % step === 0 ? (
                  <text key={index} x={sx(index)} y={height - 8} textAnchor="middle" fontSize="10" fill="#7b8191">{String(label)}</text>
                ) : null)) : null}
              </g>
            );
          })}

        {chart.threshold ? (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={sy(chart.threshold.value)}
              y2={sy(chart.threshold.value)}
              stroke="#c23b3b"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            <text x={width - pad.right} y={sy(chart.threshold.value) - 5} textAnchor="end" fontSize="11" fill="#c23b3b">
              {chart.threshold.label} {chart.threshold.value}
            </text>
          </g>
        ) : null}
      </svg>
      {chart.series.length > 1 ? (
        <figcaption className="chart-legend">
          {chart.series.map((series, s) => (
            <span key={series.name}><i style={{ background: COLORS[s % COLORS.length] }} />{series.name}</span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
