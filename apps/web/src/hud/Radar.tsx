import type { ProfileItem } from '../api';

/** 五维能力画像雷达图；数值只来自服务端返回的 profile */
export function Radar({ items }: { items: ProfileItem[] }) {
  const width = 360;
  const height = 270;
  const cx = width / 2;
  const cy = height / 2 + 6;
  const radius = 92;
  const point = (index: number, ratio: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / items.length;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
  };
  const polygon = (ratio: number) => items.map((_, index) => point(index, ratio).join(',')).join(' ');
  const values = items.map((item, index) => point(index, item.max ? Math.max(0, Math.min(1, item.score / item.max)) : 0).join(',')).join(' ');
  return (
    <figure className="radar">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="五维能力画像">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <polygon key={ratio} points={polygon(ratio)} fill="none" stroke="#2a3e4f" />
        ))}
        {items.map((_, index) => {
          const [x, y] = point(index, 1);
          return <line key={index} x1={cx} y1={cy} x2={x} y2={y} stroke="#2a3e4f" />;
        })}
        <polygon points={values} fill="rgba(103,210,227,0.22)" stroke="#67D2E3" strokeWidth={2} />
        {items.map((item, index) => {
          const [x, y] = point(index, 1.22);
          return (
            <text key={item.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#c8d6e1">
              {item.label}
            </text>
          );
        })}
      </svg>
      <ul className="radar-list">
        {items.map((item) => (
          <li key={item.key}>
            <span>{item.label}</span>
            <b>{item.max ? `${item.score.toFixed(1)} / ${item.max}` : '—'}</b>
          </li>
        ))}
      </ul>
    </figure>
  );
}
