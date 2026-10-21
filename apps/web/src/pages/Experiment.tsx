import { useEffect, useMemo, useState } from 'react';
import { BRAND, STEPS, getStep } from '@zhian/shared';
import type { ProfileItem } from '../api';
import { ResultPanel } from '../components/ResultPanel';
import { StepWorkspace } from '../components/StepWorkspace';
import { useSessionStore } from '../stores/session';

const STAGES = [...new Set(STEPS.map((step) => step.stage))];

export function Experiment() {
  const store = useSessionStore();
  const { user, session, viewStepId, results, loading, error } = store;
  const [profile, setProfile] = useState<ProfileItem[] | null>(null);

  useEffect(() => {
    if (!session) void store.start();
  }, [session]);

  const step = getStep(viewStepId) ?? STEPS[0]!;
  const input = store.inputFor(step.id);
  const result = results[step.id] ?? null;
  const done = useMemo(() => new Set(session?.stepRecords.map((record) => record.stepId) ?? []), [session]);
  const currentIndex = STEPS.findIndex((item) => item.id === session?.currentStepId);
  const nextStep = STEPS[step.seq] ?? null;

  const reachable = (index: number) => index <= Math.max(currentIndex, 0) || done.has(STEPS[index]!.id);

  return (
    <div className="app-shell">
      <div>
        <div className="hazard" />
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">安</div>
            <div className="brand-text">
              <strong>{BRAND.name}</strong>
              <span>{BRAND.fullName}</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="badge">{BRAND.direction}</span>
            <span>{user?.username}</span>
            <span className="score-pill">{(session?.totalScore ?? 0).toFixed(1)} / 100</span>
            <button className="ghost" onClick={() => { setProfile(null); void store.reset(); }} disabled={loading}>重新开始</button>
            <button className="ghost" onClick={store.logout}>退出</button>
          </div>
        </header>
      </div>

      <main className="lab">
        <nav className="panel" aria-label="实验步骤">
          <div className="panel-title">实验步骤 · {done.size}/24</div>
          {STAGES.map((stage) => {
            const items = STEPS.filter((item) => item.stage === stage);
            const finished = items.filter((item) => done.has(item.id)).length;
            return (
              <div className="stage-group" key={stage}>
                <h4><span>{stage}</span><span>{finished}/{items.length}</span></h4>
                {items.map((item) => {
                  const index = item.seq - 1;
                  const classes = ['step-item', item.id === step.id ? 'active' : '', done.has(item.id) ? 'done' : ''].join(' ');
                  return (
                    <button
                      key={item.id}
                      className={classes}
                      disabled={!reachable(index)}
                      onClick={() => store.view(item.id)}
                      style={{ opacity: reachable(index) ? 1 : 0.45 }}
                    >
                      <span className="step-dot">{done.has(item.id) ? '✓' : item.seq}</span>
                      <span>{item.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <section className="panel workspace">
          <div className="workspace-head">
            <div className="crumb">{step.stage} · 第 {step.seq} 步 / 共 24 步 · {step.type === 'scene' ? '三维交互' : step.type === 'chart' ? '数据研判' : step.type === 'ai' ? '智能体协同' : step.type === 'auto' ? '自动生成' : '方案设计'}</div>
            <h2>{step.name}</h2>
            <p>{step.description}</p>
          </div>

          <div className="workspace-body">
            <StepWorkspace
              step={step}
              input={input}
              result={result}
              sessionId={session?.sessionId}
              onChange={(key, value) => store.setField(step.id, key, value)}
              onProfile={setProfile}
            />
            {error ? (
              <div className="error">
                {error} <button className="ghost" onClick={store.clearError} style={{ marginLeft: 8 }}>知道了</button>
              </div>
            ) : null}
          </div>

          <div className="workspace-foot">
            <span className="badge">本步满分 {step.maxScore}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={result ? 'ghost' : 'primary'} onClick={() => void store.submit(step.id)} disabled={loading || !session}>
                {loading ? '提交中…' : result ? '重新提交' : '提交本步'}
              </button>
              {result && nextStep ? (
                <button className="primary" onClick={() => store.view(nextStep.id)}>进入下一步 →</button>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="panel">
          <ResultPanel result={result} session={session} profile={step.id === 'S24' ? profile : null} />
        </aside>
      </main>
    </div>
  );
}
