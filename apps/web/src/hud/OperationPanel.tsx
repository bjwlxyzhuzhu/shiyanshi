import { useEffect, useRef } from 'react';
import { SCENARIO, STEPS, SYNTHETIC_DEVICE_PROFILE, describeProfile, getStep, nextStepId, type StepDefinition, type StepResult } from '@zhian/shared';
import { ChartView } from '../components/ChartView';
import { FieldInput } from '../components/FieldInput';
import { ImagePreview } from '../components/ImagePreview';
import { PREVIEW_STEPS, inputHash, useSessionStore, useStepInput } from '../stores/session';
import { continueFrom, returnToWorld } from '../world/actions';
import { HOTSPOT_BY_ID, STEP_HOTSPOT, ZONE_BY_ID } from '../world/layout';
import type { TraceHop } from '../world/sceneAdapter';
import { useWorldStore } from '../world/worldStore';
import { IlabSyncBlock } from './IlabSync';
import { KnowledgeBlock, LadderView, ProcessView, TutorBlock } from './Learning';
import { Radar } from './Radar';

const HIDDEN = new Set(['chart', 'preview', 'image', 'verdicts', 'trace', 'profile', '关键错误']);
const WIDE = new Set(['checklist', 'order', 'text']);

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join('；');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${display(v)}`).join('，');
  return String(value);
}

function tone(ratio: number): 'good' | 'mid' | 'bad' {
  if (ratio >= 0.85) return 'good';
  if (ratio >= 0.6) return 'mid';
  return 'bad';
}

type Status = { kind: 'readonly' | 'idle' | 'submitting' | 'failed' | 'recorded' | 'dirty'; text: string };

function useStepStatus(step: StepDefinition): Status {
  const submitting = useSessionStore((state) => state.submitting);
  const submitError = useSessionStore((state) => state.submitError);
  const result = useSessionStore((state) => state.results[step.id]);
  const canSubmit = useSessionStore((state) => state.canSubmit(step.id));
  const dirty = useSessionStore((state) => state.isDirty(step.id));
  if (!canSubmit) return { kind: 'readonly', text: '只读回看 · 已提交记录' };
  if (submitting === step.id) return { kind: 'submitting', text: '提交中，等待服务端评分…' };
  if (submitError?.stepId === step.id) return { kind: 'failed', text: '提交失败，输入已保留' };
  if (result && dirty) return { kind: 'dirty', text: '输入已修改 · 尚未验证' };
  if (result) return { kind: 'recorded', text: '已记录 · 服务端评分' };
  return { kind: 'idle', text: '尚未提交' };
}

/** S16：按实际 trace 绘制——读取为根，外发分支只在读取执行后出现 */
function TraceView({ trace }: { trace: TraceHop[] }) {
  const [root, ...branches] = trace;
  const outcomeClass = (outcome: string) => (outcome === '执行' ? 'run' : outcome === '被拦截' ? 'blocked' : 'pending');
  return (
    <div className="trace-tree" aria-label="攻击路径（服务端模拟结果）">
      {root ? (
        <div className={`trace-node root ${outcomeClass(root.outcome)}`}>
          <span className="trace-tool">{root.tool}</span>
          <span className="trace-action">{root.action}</span>
          <span className="trace-outcome">{root.outcome}</span>
        </div>
      ) : null}
      {branches.length ? (
        <ul className="trace-branches">
          {branches.map((hop) => (
            <li key={hop.tool} className={`trace-node ${outcomeClass(hop.outcome)}`}>
              <span className="trace-tool">{hop.tool}</span>
              <span className="trace-action">{hop.action}</span>
              <span className="trace-outcome">{hop.outcome === '待人工确认' ? '待人工确认（未执行、未批准）' : hop.outcome}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">文件读取未执行，后续外发分支没有发生。</p>
      )}
    </div>
  );
}

function ResultBlock({ step, result, dirty }: { step: StepDefinition; result: StepResult; dirty: boolean }) {
  const ratio = result.maxScore ? result.score / result.maxScore : 0;
  const trace = (result.result.trace as TraceHop[] | undefined) ?? null;
  const entries = Object.entries(result.result).filter(([key]) => !HIDDEN.has(key));
  const critical = result.result.关键错误 ? display(result.result.关键错误) : null;
  const legacy = useSessionStore((state) => state.legacy[step.id] ?? false);
  return (
    <section className={`result-block${dirty ? ' stale' : ''}`} aria-live="polite">
      <header>
        <h3>{legacy ? '旧版题库记录' : dirty ? '上次提交结果' : '提交结果'}</h3>
        <span className="source-chip">服务端评分</span>
      </header>
      {legacy ? <p className="stale-note">该记录按 2026-10-23 产业规程修正前的旧版题库评分，仅供回看；本步题目已更新，重新提交将按新题库评分。</p> : null}
      {!legacy && dirty ? <p className="stale-note">当前输入已修改，以下内容对应上一次提交，不代表新输入的判定。</p> : null}
      {critical ? (
        <p className="critical-badge" role="alert"><b>关键安全错误</b>{critical}</p>
      ) : null}
      <div className="score-line">
        <b>{result.score}</b><span>/ {result.maxScore} 分</span>
        <div className={`meter ${tone(ratio)}`}><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
      </div>
      {ratio < 1 ? <p className="muted small">已提交不等于全部正确；可以查看反馈后继续实验。</p> : null}
      <p className={`feedback ${tone(ratio)}`}>{result.feedback}</p>
      {entries.length ? (
        <dl className="kv">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{display(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {step.id === 'S16' && trace ? (
        <div className="block">
          <h4>攻击路径 · 依据服务端模拟</h4>
          <TraceView trace={trace} />
        </div>
      ) : null}
      {step.id === 'S20' ? <p className="muted small">本步只核验分情景处置决定，没有逐时刻冷却模拟；场景中只显示“预案核验完成”状态。</p> : null}
    </section>
  );
}

function PreviewBlock({ step }: { step: StepDefinition }) {
  const preview = useSessionStore((state) => state.previews[step.id]);
  const input = useStepInput(step.id);
  const requestPreview = useSessionStore((state) => state.requestPreview);
  const canSubmit = useSessionStore((state) => state.canSubmit(step.id));
  const hash = inputHash(input);
  useEffect(() => {
    if (!preview || preview.forHash !== hash) requestPreview(step.id);
    // 只在打开步骤时补一次初始预览；之后由字段修改触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const fresh = preview?.forHash === hash;
  const label = !preview || (preview.status === 'loading' && !preview.chart && !preview.preview)
    ? '正在请求后端预览…'
    : preview.status === 'loading'
      ? '更新中…'
      : preview.status === 'error'
        ? '预览请求失败，下方为过期预览'
        : fresh ? '已与当前输入同步' : '更新中…';

  return (
    <section className="preview-block">
      <header>
        <h3>{step.id === 'S06' ? '实时脱敏预览' : '实时仿真预览'}</h3>
        <span className={`preview-status ${preview?.status === 'error' ? 'error' : fresh && preview?.status === 'ok' ? 'ok' : 'loading'}`}>{label}</span>
      </header>
      {preview?.status === 'error' ? (
        <button type="button" className="ghost small" onClick={() => requestPreview(step.id)} disabled={!canSubmit}>重试预览</button>
      ) : null}
      {preview?.preview ? <pre className="masked-preview">{preview.preview}</pre> : null}
      {preview?.image ? <ImagePreview image={preview.image} /> : null}
      {preview?.chart ? (
        <ChartView
          chart={preview.chart}
          xLabel={step.id === 'S19' ? '模拟时间 / s' : undefined}
          note={step.id === 'S19' ? '教学热路模型计算的仿真曲线，非本机或真实设备测量；参考线为合成教学档案中的告警/降频/关断阈值，只适用于 GPU 核心温度测点。' : '后端仿真预览，不含评分。'}
        />
      ) : null}
      {!preview?.chart && !preview?.preview && preview?.status === 'ok' ? <p className="muted small">后端没有返回可显示的预览。</p> : null}
    </section>
  );
}

function ReviewBlock({ step }: { step: StepDefinition }) {
  const review = useSessionStore((state) => state.reviews[step.id]);
  const runReview = useSessionStore((state) => state.runReview);
  return (
    <section className="review-block">
      <header>
        <h3>安全助手评审</h3>
        <span className="source-chip muted">不计分</span>
      </header>
      <button type="button" className="ghost" onClick={() => void runReview(step.id)} disabled={review?.status === 'loading'}>
        {review?.status === 'loading' ? '评审中…' : review?.status === 'ok' ? '重新评审当前方案' : '请安全助手评审当前方案'}
      </button>
      {review?.status === 'error' ? <p className="error-text">{review.error}</p> : null}
      {review?.status === 'ok' && review.data ? (
        <div className="risks">
          <span className="source-chip">来源：{review.data.source === 'model' ? '大模型' : '规则引擎'}</span>
          {review.data.risks.length === 0 ? <p className="muted small">未发现明显风险。</p> : null}
          {review.data.risks.map((risk, index) => (
            <div key={index} className={`risk ${risk.level}`}>
              <b>{risk.level === 'high' ? '高' : risk.level === 'mid' ? '中' : '低'} · {risk.item}</b>
              <span>{risk.reason}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** S24：提交给分与生成报告是两个独立请求，状态分开维护 */
function ReportBlock() {
  const report = useSessionStore((state) => state.report);
  const runReport = useSessionStore((state) => state.runReport);
  const s24 = useSessionStore((state) => state.results.S24);
  return (
    <section className="report-block">
      <div className="report-status">
        <div className={`status-card ${s24 ? 'ok' : ''}`}>
          <span>实验记录</span>
          <b>{s24 ? `已提交 · ${s24.score}/${s24.maxScore} 分` : '待提交'}</b>
        </div>
        <div className={`status-card ${report.status === 'ok' ? 'ok' : report.status === 'error' ? 'bad' : ''}`}>
          <span>实验报告</span>
          <b>{report.status === 'ok' ? '已生成' : report.status === 'loading' ? '生成中…' : report.status === 'error' ? '生成失败' : '尚未生成'}</b>
        </div>
      </div>
      <button type="button" className="ghost" onClick={() => void runReport()} disabled={report.status === 'loading'}>
        {report.status === 'loading' ? '生成中…' : report.status === 'ok' ? '重新生成报告' : report.status === 'error' ? '重试生成报告' : '生成实验报告'}
      </button>
      {report.status === 'error' ? <p className="error-text">{report.error}（报告未生成，不会显示文档）</p> : null}
      {report.status === 'ok' && report.data ? (
        <>
          <div className="block">
            <h4>五维能力画像 <span className="source-chip muted">来自报告生成请求</span></h4>
            <Radar items={report.data.profile} />
          </div>
          <div className="block">
            <h4>实验报告 #{report.data.reportId}</h4>
            <pre className="report-text">{report.data.contentMd}</pre>
          </div>
        </>
      ) : (
        <p className="muted small">生成报告后显示能力画像与报告正文。</p>
      )}
    </section>
  );
}

export function OperationPanel({ stepId, docked = false }: { stepId: string; docked?: boolean }) {
  const step = getStep(stepId) ?? STEPS[0]!;
  const session = useSessionStore((state) => state.session);
  const results = useSessionStore((state) => state.results);
  const input = useStepInput(step.id);
  const setField = useSessionStore((state) => state.setField);
  const submit = useSessionStore((state) => state.submit);
  const submitting = useSessionStore((state) => state.submitting);
  const submitError = useSessionStore((state) => state.submitError);
  const canSubmit = useSessionStore((state) => state.canSubmit(step.id));
  const dirty = useSessionStore((state) => state.isDirty(step.id));
  const view = useSessionStore((state) => state.view);
  const canSubmitOf = useSessionStore((state) => state.canSubmit);
  const mode = useWorldStore((state) => state.mode);
  const status = useStepStatus(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const result = results[step.id] ?? null;
  const track = useSessionStore((state) => state.track);
  const active = (docked || mode === 'operating') && canSubmit;

  // 过程采集：面板展示可操作的步骤时记“打开/关闭”，页面隐藏/恢复记“暂停/恢复”；时间以服务器为准
  useEffect(() => {
    if (!active) return;
    track(step.id, 'open');
    const onVisibility = () => track(step.id, document.hidden ? 'pause' : 'resume');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      track(step.id, 'close');
    };
  }, [active, step.id, track]);

  useEffect(() => {
    if (docked || mode === 'operating') heading.current?.focus({ preventScroll: true });
  }, [mode, step.id, docked]);

  const hotspotId = STEP_HOTSPOT[step.id]!;
  const hotspot = HOTSPOT_BY_ID.get(hotspotId)!;
  const done = new Set(session?.stepRecords.map((record) => record.stepId) ?? []);
  const siblings = STEPS.filter((item) => STEP_HOTSPOT[item.id] === hotspotId && (done.has(item.id) || item.id === session?.currentStepId));
  const next = nextStepId(step.id);
  const nextReachable = Boolean(next && session && (session.currentStepId === next || done.has(next)));
  const showContinue = Boolean(result && next && nextReachable && !dirty && canSubmit);
  const isSubmitting = submitting === step.id;

  const onSubmit = () => {
    void submit(step.id);
  };

  return (
    <section className={`op-panel${docked ? ' docked' : ''}`} data-block-keys aria-labelledby="op-title">
      <div className="op-head">
        <div className="op-crumb">
          {step.id} / 24 · {step.stage} · {ZONE_BY_ID.get(hotspot.zone)!.name} · {hotspot.name}
        </div>
        <h2 id="op-title" ref={heading} tabIndex={-1}>{step.name}</h2>
        <div className="op-meta">
          <span className={`status-chip ${status.kind}`}>{status.text}</span>
          <span className="muted small">本步满分 {step.maxScore}</span>
        </div>
        {siblings.length > 1 ? (
          <div className="op-tabs" role="tablist" aria-label="本设备上的任务">
            {siblings.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === step.id}
                className={item.id === step.id ? 'on' : ''}
                onClick={() => view(item.id)}
              >
                {item.id}{item.id === session?.currentStepId && !(session?.finished && done.has(item.id)) ? ' · 当前' : done.has(item.id) ? (canSubmitOf(item.id) ? ' · 已提交' : ' · 回看') : ''}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="op-body">
        <p className="op-desc">{step.description}</p>
        {step.seq === 1 ? (
          <details className="material" open>
            <summary>{SCENARIO.title}</summary>
            <p>{SCENARIO.text}</p>
          </details>
        ) : null}
        {step.material ? (
          <details className="material" open>
            <summary>任务材料</summary>
            <p>{step.material}</p>
          </details>
        ) : null}
        {step.id === 'S04' || step.id === 'S19' ? (
          <details className="material profile-banner" open>
            <summary>设备档案 <span className="source-chip warn">合成教学档案 · 非真实厂商参数</span></summary>
            <p>{describeProfile(SYNTHETIC_DEVICE_PROFILE)}</p>
            <p className="muted small">真实机房须使用经运维与厂商资料确认、批准后的档案；未确认的参数记为未知，不补 0、不推定安全。</p>
          </details>
        ) : null}
        <KnowledgeBlock step={step} />
        {step.id === 'S09' ? <p className="note">本步骤为“实验结束后清理”的预演：只记录你的选择，不会删除任何真实文件。</p> : null}
        {step.id === 'S20' ? <p className="note warn">演练示意：无烟过温、火警、漏液三个情景分别处置，人身安全优先。本步只核验你的决定，不模拟处置后的温度变化，也不会触发任何真实报警或设备操作。</p> : null}
        {!canSubmit ? <p className="note">这是已提交步骤的只读回看。重新提交历史步骤会使服务端进度回退，因此这里不提供提交。</p> : null}

        {step.fields.length ? (
          <div className="form-grid">
            {step.fields.map((field) => {
              const id = `${step.id}-${field.key}`;
              const wide = WIDE.has(field.kind) || field.label.length > 12;
              return (
                <div className={`field${wide ? ' wide' : ''}`} key={field.key}>
                  {field.kind === 'checklist' || field.kind === 'order'
                    ? <span className="field-label">{field.label}</span>
                    : <label htmlFor={id}>{field.label}{field.unit ? `（${field.unit}）` : ''}</label>}
                  <FieldInput id={id} field={field} value={input[field.key]} disabled={!canSubmit || isSubmitting} onChange={(value) => setField(step.id, field.key, value)} />
                </div>
              );
            })}
          </div>
        ) : null}

        {PREVIEW_STEPS.has(step.id) && canSubmit ? <PreviewBlock step={step} /> : null}
        {step.id === 'S16' && !result ? (
          <section className="preview-block">
            <header><h3>攻击路径</h3><span className="preview-status">待验证</span></header>
            <p className="muted small">提交后由服务端模拟一次诱导外发攻击，按返回结果显示执行、被拦截或待人工确认。</p>
          </section>
        ) : null}
        {canSubmit || step.id === 'S24' ? <TutorBlock step={step} /> : null}
        {step.type === 'ai' ? <ReviewBlock step={step} /> : null}
        {step.id === 'S24' ? <ReportBlock /> : null}
        {step.id === 'S24' ? (
          <section className="preview-block">
            <header><h3>阶梯能力与过程评价</h3><span className="source-chip muted">过程评价不计入成绩</span></header>
            <LadderView />
            <ProcessView />
          </section>
        ) : null}
        {step.id === 'S24' ? <IlabSyncBlock /> : null}

        {submitError?.stepId === step.id ? (
          <div className="error-box" role="alert">
            <b>提交失败</b>
            <span>{submitError.message}</span>
            <span className="muted small">已核对服务端记录，本次提交未入库；输入已保留，可直接重试。</span>
          </div>
        ) : null}
        {result ? <ResultBlock step={step} result={result} dirty={dirty} /> : null}
      </div>

      <div className="op-foot">
        {docked ? null : <button type="button" className="ghost" onClick={returnToWorld}>返回场景</button>}
        {canSubmit ? (
          <button type="button" className={showContinue ? 'ghost' : 'primary'} onClick={onSubmit} disabled={isSubmitting || Boolean(submitting)}>
            {isSubmitting ? '提交中…' : result ? (step.id === 'S24' ? '重新提交实验记录' : '重新提交') : step.id === 'S24' ? '提交实验记录' : step.id === 'S16' ? '提交并验证' : '提交本步'}
          </button>
        ) : null}
        {showContinue ? (
          <button type="button" className="primary" onClick={() => continueFrom(step.id)}>继续实验 →</button>
        ) : null}
        {result && !next && !docked ? <span className="muted small">已到最后一步</span> : null}
      </div>
    </section>
  );
}
