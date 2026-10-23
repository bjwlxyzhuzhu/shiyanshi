import { useEffect, useRef, useState } from 'react';
import { api, type SeatStatus } from '../api';
import { BRAND, STEPS } from '@zhian/shared';
import { ActionBar, HelpDrawer, KeyHints, Notices, Objective, RecordsDrawer, SettingsDrawer, TopBar } from '../hud/Hud';
import { STAGE_SHORT } from '../world/layout';
import { OperationPanel } from '../hud/OperationPanel';
import { useSessionStore } from '../stores/session';
import { interactWith, placeAtCurrentTask, returnToWorld } from '../world/actions';
import { clearKeys, onKey } from '../world/input';
import type { SceneState } from '../world/sceneAdapter';
import { camera, readCheckpoint, useWorldStore, writeCheckpoint } from '../world/worldStore';

function LoadingVeil() {
  const loading = useSessionStore((state) => state.loading);
  const session = useSessionStore((state) => state.session);
  const error = useSessionStore((state) => state.error);
  const start = useSessionStore((state) => state.start);
  if (session) return null;
  return (
    <div className="veil" role="status">
      {error && !loading ? (
        <div className="veil-card">
          <b>无法开始实验</b>
          <p>{error}</p>
          <button type="button" className="primary" onClick={() => void start()}>重试</button>
        </div>
      ) : (
        <div className="veil-card"><span className="spinner" aria-hidden />正在恢复实验进度…</div>
      )}
    </div>
  );
}

/** WebGL 不可用或用户选择时的 HTML 实验模式：原字段、原接口、同样的提交与回看规则 */
function HtmlExperiment() {
  const session = useSessionStore((state) => state.session);
  const viewStepId = useSessionStore((state) => state.viewStepId);
  const view = useSessionStore((state) => state.view);
  const user = useSessionStore((state) => state.user);
  const logout = useSessionStore((state) => state.logout);
  const setPage = useSessionStore((state) => state.setPage);
  const webglIssue = useWorldStore((state) => state.webglIssue);
  const setHtmlMode = useWorldStore((state) => state.setHtmlMode);
  const setDrawer = useWorldStore((state) => state.setDrawer);
  const drawer = useWorldStore((state) => state.drawer);
  const done = new Set(session?.stepRecords.map((record) => record.stepId) ?? []);
  const stages = [...new Set(STEPS.map((step) => step.stage))];
  return (
    <div className="html-mode">
      <header className="html-top">
        <div className="hud-brand"><span className="brand-mark" aria-hidden>安</span><strong>{BRAND.name}</strong><span className="hud-crumb">HTML 实验模式</span></div>
        <div className="html-top-actions">
          <span className="muted">{user?.username} · {(session?.totalScore ?? 0).toFixed(1)} / 100</span>
          {!webglIssue ? <button type="button" className="ghost" onClick={() => setHtmlMode(false)}>返回三维场景</button> : null}
          <button type="button" className="ghost" onClick={() => setDrawer('records')}>任务记录</button>
          {user && user.role !== 'student' ? <button type="button" className="ghost" onClick={() => setPage('admin')}>{user.role === 'admin' ? '管理后台' : '教师后台'}</button> : null}
          <button type="button" className="ghost" onClick={logout}>退出</button>
        </div>
      </header>
      {webglIssue ? <div className="html-banner" role="alert">{webglIssue}</div> : null}
      <div className="html-grid">
        <nav className="html-nav" aria-label="实验步骤">
          {stages.map((stage) => (
            <section key={stage}>
              <h3>{STAGE_SHORT[stage] ?? stage}</h3>
              {STEPS.filter((step) => step.stage === stage).map((step) => {
                const reachable = done.has(step.id) || step.id === session?.currentStepId;
                return (
                  <button
                    key={step.id}
                    type="button"
                    className={`html-step${step.id === viewStepId ? ' on' : ''}${done.has(step.id) ? ' done' : ''}`}
                    disabled={!reachable}
                    onClick={() => view(step.id)}
                  >
                    <span>{step.id}</span>
                    <span>{step.name}</span>
                    <small>{step.id === session?.currentStepId && !(session?.finished && done.has(step.id)) ? '当前' : done.has(step.id) ? '已提交' : '未开放'}</small>
                  </button>
                );
              })}
            </section>
          ))}
        </nav>
        <main className="html-main">{session ? <OperationPanel stepId={viewStepId} docked /> : null}</main>
      </div>
      {drawer === 'records' ? <RecordsDrawer onReview={(stepId) => { view(stepId); setDrawer('none'); }} /> : null}
    </div>
  );
}

/** 超出承诺并发数时的排队提示：显示位置与预计等待，定期重试 */
function QueueVeil({ status }: { status: SeatStatus }) {
  const minutes = status.estimatedWaitSec ? Math.max(1, Math.round(status.estimatedWaitSec / 60)) : null;
  return (
    <div className="veil" role="status" aria-live="polite">
      <div className="veil-card">
        <span className="spinner" aria-hidden />
        <b>当前在线人数已满（{status.active}/{status.limit}）</b>
        <p>您排在第 {status.position ?? '—'} 位{minutes ? `，预计等待约 ${minutes} 分钟` : ''}。页面会自动重试，请勿关闭。</p>
      </div>
    </div>
  );
}

export function Experiment({ scene }: { scene: SceneState }) {
  const session = useSessionStore((state) => state.session);
  const user = useSessionStore((state) => state.user);
  const start = useSessionStore((state) => state.start);
  const viewStepId = useSessionStore((state) => state.viewStepId);
  const view = useSessionStore((state) => state.view);
  const mode = useWorldStore((state) => state.mode);
  const drawer = useWorldStore((state) => state.drawer);
  const htmlMode = useWorldStore((state) => state.htmlMode);
  const introSeen = useWorldStore((state) => state.introSeen);
  const focusHotspotId = useWorldStore((state) => state.focusHotspotId);

  const [seat, setSeat] = useState<SeatStatus | null>(null);
  const admitted = seat?.admitted === true;
  const hintLevel = useWorldStore((state) => state.hintLevel);
  const lastHint = useRef(0);

  // 并发席位：进入时申请，满员排队轮询；进入后每 30 秒心跳，离开页面释放
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = async (action: 'enter' | 'heartbeat') => {
      try {
        const status = await api.presence(action);
        if (cancelled) return;
        setSeat(status);
        timer = window.setTimeout(() => void tick(status.admitted ? 'heartbeat' : 'enter'), status.admitted ? 30_000 : 5_000);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void tick('enter'), 5_000);
      }
    };
    void tick('enter');
    const onQueued = (event: Event) => {
      setSeat((event as CustomEvent<SeatStatus>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick('enter'), 5_000);
    };
    const onLeave = () => void api.presence('leave').catch(() => undefined);
    window.addEventListener('zhian:queued', onQueued);
    window.addEventListener('pagehide', onLeave);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('zhian:queued', onQueued);
      window.removeEventListener('pagehide', onLeave);
    };
  }, []);

  useEffect(() => {
    if (!session && admitted) void start();
  }, [session, start, admitted]);

  // 过程评价：记录提示使用（只在提示层级提升时记一次）
  useEffect(() => {
    if (hintLevel > lastHint.current && session) useSessionStore.getState().track(session.currentStepId, 'hint');
    lastHint.current = hintLevel;
  }, [hintLevel, session]);

  // 会话就绪后：人物放到当前任务设备的安全站位，相机从展示镜头过渡到跟随
  useEffect(() => {
    if (!session || !user) return;
    const world = useWorldStore.getState();
    if (world.mode !== 'attract' && world.mode !== 'loading') return;
    const checkpoint = readCheckpoint(user.id, session.sessionId);
    placeAtCurrentTask(session.currentStepId, session.stepRecords.length > 0, checkpoint?.yaw);
    if (checkpoint?.introSeen) world.setIntroSeen();
    world.setMode('exploring');
  }, [session, user]);

  useEffect(() => {
    if (!session || !user) return;
    writeCheckpoint(user.id, session.sessionId, { introSeen, yaw: camera.yaw });
  }, [introSeen, mode, session, user]);

  useEffect(() => {
    if (mode === 'focusing' && !introSeen) useWorldStore.getState().setIntroSeen();
  }, [mode, introSeen]);

  useEffect(() => {
    const offInteract = onKey('interact', () => {
      const world = useWorldStore.getState();
      if (world.htmlMode || world.mode !== 'exploring' || world.drawer !== 'none' || !world.nearHotspotId) return;
      interactWith(world.nearHotspotId);
    });
    const offHint = onKey('hint', () => {
      if (!useWorldStore.getState().htmlMode) useWorldStore.getState().cycleHint();
    });
    const offEscape = onKey('escape', () => {
      const world = useWorldStore.getState();
      if (world.drawer !== 'none') {
        if (world.drawer === 'review') {
          const current = useSessionStore.getState().session?.currentStepId;
          if (current) useSessionStore.getState().view(current);
        }
        world.setDrawer('none');
        return;
      }
      if (world.mode === 'operating' || world.mode === 'focusing') returnToWorld();
      else if (world.hintLevel > 0) world.setHint(0);
    });
    return () => {
      offInteract();
      offHint();
      offEscape();
    };
  }, []);

  useEffect(() => {
    if (drawer !== 'none') clearKeys();
  }, [drawer]);

  if (htmlMode) return <>{seat && !seat.admitted ? <QueueVeil status={seat} /> : null}<HtmlExperiment /></>;

  const panelOpen = (mode === 'focusing' || mode === 'operating') && Boolean(focusHotspotId);
  const closeReview = () => {
    if (session) view(session.currentStepId);
    useWorldStore.getState().setDrawer('none');
  };

  return (
    <div className={`hud-layer${panelOpen ? ' panel-open' : ''}`}>
      <TopBar scene={scene} />
      {panelOpen ? null : <Objective scene={scene} />}
      <Notices />
      {panelOpen ? (
        <div className={`panel-dock${mode === 'operating' ? ' in' : ''}`}>
          <OperationPanel stepId={viewStepId} />
        </div>
      ) : (
        <>
          <KeyHints />
          <ActionBar scene={scene} />
        </>
      )}
      {panelOpen ? <div className="esc-hint"><kbd>Esc</kbd> 返回场景</div> : null}
      {drawer === 'records' ? (
        <RecordsDrawer onReview={(stepId) => { view(stepId); useWorldStore.getState().setDrawer('review'); }} />
      ) : null}
      {drawer === 'review' ? (
        <div className="drawer-backdrop" onClick={closeReview}>
          <div className="panel-dock in review" onClick={(event) => event.stopPropagation()}>
            <OperationPanel stepId={viewStepId} docked />
            <button type="button" className="ghost review-close" onClick={closeReview}>关闭回看</button>
          </div>
        </div>
      ) : null}
      {drawer === 'settings' ? <SettingsDrawer /> : null}
      {drawer === 'help' ? <HelpDrawer /> : null}
      {seat && !seat.admitted ? <QueueVeil status={seat} /> : <LoadingVeil />}
    </div>
  );
}
