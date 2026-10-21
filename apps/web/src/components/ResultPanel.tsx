import { buildProfile, type SessionState, type StepResult } from '@zhian/shared';
import type { ProfileItem } from '../api';

const HIDDEN = new Set(['chart', 'preview', 'verdicts', 'trace', 'profile']);

function tone(ratio: number): 'good' | 'mid' | 'bad' {
  if (ratio >= 0.85) return 'good';
  if (ratio >= 0.6) return 'mid';
  return 'bad';
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join('；');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${display(v)}`).join('，');
  return String(value);
}

export function ResultPanel({
  result,
  session,
  profile
}: {
  result: StepResult | null;
  session: SessionState | null;
  profile: ProfileItem[] | null;
}) {
  const live = profile ?? buildProfile(session?.stepRecords ?? []);
  const ratio = result ? result.score / result.maxScore : 0;
  const trace = (result?.result.trace as Array<{ action: string; tool: string; outcome: string }> | undefined) ?? null;

  return (
    <>
      <div className="panel-title">结果与反馈</div>
      <section className="side-section">
        {result ? (
          <>
            <div className="score-big">
              <span className="badge">{result.stepId}</span>
              <b>{result.score} <small style={{ fontSize: 14, color: 'var(--muted)' }}>/ {result.maxScore}</small></b>
            </div>
            <div className={`meter ${tone(ratio)}`}><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
            <div className={`feedback ${tone(ratio)}`}>{result.feedback}</div>
            <dl className="kv" style={{ marginTop: 12 }}>
              {Object.entries(result.result)
                .filter(([key]) => !HIDDEN.has(key))
                .map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{key}</dt>
                    <dd>{display(value)}</dd>
                  </div>
                ))}
            </dl>
            {trace ? (
              <ul className="trace" style={{ marginTop: 12 }}>
                {trace.map((hop) => (
                  <li key={hop.action}>
                    <span>{hop.action}</span>
                    <span className={hop.outcome === '执行' ? 'tag-bad' : hop.outcome === '被拦截' ? 'tag-ok' : 'tag-mid'}>{hop.outcome}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="empty">提交本步后，这里显示得分、判定依据与改进建议。</p>
        )}
      </section>

      <section className="side-section">
        <h3>能力画像</h3>
        <div className="profile-bars">
          {live.map((item) => (
            <div className="row" key={item.key}>
              <span>{item.label}</span>
              <div className={`meter ${item.max ? tone(item.score / item.max) : ''}`}>
                <i style={{ width: `${item.max ? Math.round((item.score / item.max) * 100) : 0}%` }} />
              </div>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.max ? `${Math.round(item.percent)}%` : '—'}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
