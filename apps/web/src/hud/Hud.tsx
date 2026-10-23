import { useEffect, useMemo, useState } from 'react';
import { BRAND, STEPS, buildProfile, getStep } from '@zhian/shared';
import { useSessionStore } from '../stores/session';
import { interactWith } from '../world/actions';
import { HOTSPOT_BY_ID, STAGE_SHORT, STEP_OBJECTIVE, STEP_OPERATION_HINT, ZONE_BY_ID, hotspotForStep } from '../world/layout';
import type { SceneState } from '../world/sceneAdapter';
import { perf, useWorldStore, type Quality } from '../world/worldStore';
import { ArchiveView, CourseView, ExploreView, LadderView, NetworkCheck, PrelabView, ProjectInfo } from './Learning';

export function TopBar({ scene }: { scene: SceneState }) {
  const session = useSessionStore((state) => state.session);
  const ilab = useSessionStore((state) => state.ilab);
  const step = session ? getStep(session.currentStepId) : null;
  return (
    <header className="hud-top">
      <div className="hud-brand">
        <span className="brand-mark" aria-hidden>安</span>
        <strong>{BRAND.name}</strong>
        {step ? (
          <span className="hud-crumb">
            {step.stage} · {step.id} / 24{session?.finished ? ' · 已完成全部提交' : ''}
          </span>
        ) : null}
        {ilab?.bound ? (
          <span className="ilab-chip" title="本次实验由实验空间进入，完成后在 S24 提交">
            实验空间{ilab.synthetic ? ' · 模拟' : ''}{ilab.locked ? ' · 已提交只读' : ''}
          </span>
        ) : null}
      </div>
      <ol className="stage-track" aria-label="五个阶段进度（依据已提交记录）">
        {scene.stages.map((stage) => (
          <li key={stage.label} className={`${stage.current ? 'current' : ''}${stage.done === stage.total ? ' complete' : ''}`}>
            <i aria-hidden />
            <span>{STAGE_SHORT[stage.label] ?? stage.label}</span>
            <small>{stage.done}/{stage.total}</small>
          </li>
        ))}
      </ol>
    </header>
  );
}

/** 左上任务目标；H 提示分三层：题干 → 位置 → 控件说明（不给答案） */
export function Objective({ scene }: { scene: SceneState }) {
  const session = useSessionStore((state) => state.session);
  const hintLevel = useWorldStore((state) => state.hintLevel);
  const setHint = useWorldStore((state) => state.setHint);
  if (!session) return null;
  const finished = session.finished && session.stepRecords.some((record) => record.stepId === session.currentStepId);
  const step = getStep(session.currentStepId);
  const hotspot = hotspotForStep(session.currentStepId);
  if (!step || !hotspot) return null;
  const zone = ZONE_BY_ID.get(hotspot.zone)!;
  return (
    <section className="hud-objective" aria-live="polite">
      <div className="objective-line">
        <span className="target-icon" aria-hidden />
        <b>{finished ? '全部步骤已提交，可在复盘终端生成或查看报告' : STEP_OBJECTIVE[step.id]}</b>
      </div>
      {!finished ? <div className="objective-sub">{step.id} · {step.name} · 前往{zone.name}的{hotspot.name}</div> : null}
      {hintLevel > 0 ? (
        <div className="hint-box">
          <div className="hint-head">
            <span>提示 {hintLevel}/3</span>
            <button type="button" className="link" onClick={() => setHint(0)}>收起</button>
          </div>
          <p><b>目标：</b>{step.description}</p>
          {hintLevel >= 2 ? <p><b>位置：</b>{zone.name}（{zone.english}），设备“{hotspot.name}”，编号 {hotspot.code}。沿地面琥珀色导引线经门洞前往，站到发光圆环内按 E。</p> : null}
          {hintLevel >= 3 ? <p><b>操作：</b>{STEP_OPERATION_HINT[step.id]}</p> : null}
          {hintLevel < 3 ? <button type="button" className="link" onClick={() => setHint((hintLevel + 1) as 1 | 2 | 3)}>更多提示（H）</button> : null}
        </div>
      ) : null}
    </section>
  );
}

export function KeyHints() {
  return (
    <div className="hud-keys" aria-hidden>
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
      <span>鼠标拖动观察</span>
      <span><kbd>E</kbd> 交互</span>
      <span><kbd>H</kbd> 提示</span>
      <span><kbd>Esc</kbd> 返回</span>
    </div>
  );
}

/** 底部操作：键盘之外的可点击入口（也供触屏使用） */
export function ActionBar({ scene }: { scene: SceneState }) {
  const near = useWorldStore((state) => state.nearHotspotId);
  const mode = useWorldStore((state) => state.mode);
  const autoWalk = useWorldStore((state) => state.autoWalk);
  const setAutoWalk = useWorldStore((state) => state.setAutoWalk);
  const setDrawer = useWorldStore((state) => state.setDrawer);
  const cycleHint = useWorldStore((state) => state.cycleHint);
  const user = useSessionStore((state) => state.user);
  const setPage = useSessionStore((state) => state.setPage);
  const exploring = mode === 'exploring' || mode === 'returning';
  const nearHotspot = near ? HOTSPOT_BY_ID.get(near) : null;
  const nearStatus = near ? scene.hotspots[near] : null;
  const atTarget = near && near === scene.currentHotspotId;
  return (
    <div className="hud-actions">
      {exploring && nearHotspot && nearStatus !== 'locked' ? (
        <button type="button" className="primary interact" onClick={() => interactWith(nearHotspot.id)}>
          <kbd>E</kbd> {nearStatus === 'current' ? `操作${nearHotspot.name}` : `回看${nearHotspot.name}`}
        </button>
      ) : null}
      {exploring && scene.currentHotspotId && !atTarget ? (
        <button type="button" className="ghost" aria-pressed={autoWalk} onClick={() => setAutoWalk(!autoWalk)}>
          {autoWalk ? '停止自动前往' : '自动前往当前任务'}
        </button>
      ) : null}
      <button type="button" className="ghost" onClick={cycleHint}>提示 H</button>
      <button type="button" className="ghost" onClick={() => setDrawer('records')}>任务记录</button>
      <button type="button" className="ghost" onClick={() => setDrawer('settings')}>设置</button>
      <button type="button" className="ghost" onClick={() => setDrawer('help')}>帮助</button>
      {user && user.role !== 'student' ? <button type="button" className="ghost" onClick={() => setPage('admin')}>{user.role === 'admin' ? '管理后台' : '教师后台'}</button> : null}
    </div>
  );
}

export function Notices() {
  const notice = useWorldStore((state) => state.notice);
  const introSeen = useWorldStore((state) => state.introSeen);
  const mode = useWorldStore((state) => state.mode);
  const setIntroSeen = useWorldStore((state) => state.setIntroSeen);
  if (mode !== 'exploring' && mode !== 'returning') return null;
  return (
    <div className="hud-notices" aria-live="polite">
      {!introSeen ? (
        <div className="notice intro">
          <span>用 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键移动，按住鼠标拖动转动视角，沿琥珀色导引线前往当前任务设备。</span>
          <button type="button" className="link" onClick={setIntroSeen}>知道了</button>
        </div>
      ) : null}
      {notice ? <div className="notice">{notice}</div> : null}
    </div>
  );
}

function Drawer({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const first = document.querySelector<HTMLElement>('.drawer [data-autofocus]');
    first?.focus();
  }, []);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="ghost" data-autofocus onClick={onClose}>关闭</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function RecordsDrawer({ onReview }: { onReview: (stepId: string) => void }) {
  const session = useSessionStore((state) => state.session);
  const user = useSessionStore((state) => state.user);
  const results = useSessionStore((state) => state.results);
  const reset = useSessionStore((state) => state.reset);
  const logout = useSessionStore((state) => state.logout);
  const loading = useSessionStore((state) => state.loading);
  const setDrawer = useWorldStore((state) => state.setDrawer);
  const [confirming, setConfirming] = useState(false);
  const profile = useMemo(() => buildProfile(session?.stepRecords ?? []), [session]);
  const done = new Set(session?.stepRecords.map((record) => record.stepId) ?? []);
  const stages = [...new Set(STEPS.map((step) => step.stage))];
  return (
    <Drawer title="任务记录" onClose={() => setDrawer('none')}>
      <div className="records-summary">
        <div><span>账号</span><b>{user?.username}</b></div>
        <div><span>已提交</span><b>{done.size} / 24</b></div>
        <div><span>累计得分</span><b>{(session?.totalScore ?? 0).toFixed(1)} / 100</b></div>
      </div>
      <p className="muted small">得分来自服务端评分；已提交不等于全部正确。历史步骤只读回看，不会重新评分。</p>
      {stages.map((stage) => (
        <section key={stage} className="records-stage">
          <h3>{stage}</h3>
          <ul>
            {STEPS.filter((step) => step.stage === stage).map((step) => {
              const result = results[step.id];
              const isCurrent = step.id === session?.currentStepId && !(session?.finished && done.has(step.id));
              return (
                <li key={step.id} className={isCurrent ? 'current' : done.has(step.id) ? 'done' : 'locked'}>
                  <span className="rec-id">{step.id}</span>
                  <span className="rec-name">{step.name}</span>
                  <span className="rec-state">
                    {isCurrent ? '当前任务' : done.has(step.id) ? `${result?.score ?? session?.stepRecords.find((r) => r.stepId === step.id)?.score ?? 0} / ${step.maxScore}` : '未开放'}
                  </span>
                  {done.has(step.id) ? <button type="button" className="ghost small" onClick={() => onReview(step.id)}>回看</button> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className="records-stage">
        <h3>当前能力画像 <span className="source-chip muted">依据已提交记录实时计算</span></h3>
        <div className="profile-bars">
          {profile.map((item) => (
            <div className="row" key={item.key}>
              <span>{item.label}</span>
              <div className="meter"><i style={{ width: `${item.max ? Math.round((item.score / item.max) * 100) : 0}%` }} /></div>
              <span>{item.max ? `${item.score.toFixed(1)}/${item.max}` : '—'}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="records-stage">
        <h3>预习测验 <span className="source-chip muted">预习成绩</span></h3>
        <PrelabView />
      </section>
      <section className="records-stage">
        <h3>研究探索 <span className="source-chip muted">选做 · 不计分</span></h3>
        <ExploreView />
      </section>
      <section className="records-stage">
        <h3>阶梯能力 <span className="source-chip muted">基础 → 综合 → 复杂问题</span></h3>
        <LadderView />
      </section>
      <section className="records-stage">
        <h3>跨学科学习经历 <span className="source-chip muted">五门课程关联步骤得分率</span></h3>
        <CourseView />
      </section>
      <section className="records-stage">
        <h3>成长档案 <span className="source-chip muted">本人历次实验</span></h3>
        <ArchiveView />
      </section>
      <section className="records-stage danger-zone">
        <h3>会话</h3>
        {confirming ? (
          <div className="confirm">
            <p>重新开始会清空本次会话的全部提交记录与得分，且不可撤销。确定吗？</p>
            <button type="button" className="danger" disabled={loading} onClick={() => { void reset().then(() => { setConfirming(false); setDrawer('none'); }); }}>确定重新开始</button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>取消</button>
          </div>
        ) : (
          <div className="confirm">
            <button type="button" className="ghost" onClick={() => setConfirming(true)}>重新开始实验…</button>
            <button type="button" className="ghost" onClick={logout}>退出登录</button>
          </div>
        )}
      </section>
    </Drawer>
  );
}

function measure() {
  const frames = [...perf.frames].sort((a, b) => a - b);
  if (frames.length < 30) return null;
  const avg = frames.reduce((sum, value) => sum + value, 0) / frames.length;
  const p95 = frames[Math.floor(frames.length * 0.95)]!;
  return { fps: 1000 / avg, p95, samples: frames.length };
}

export function SettingsDrawer() {
  const quality = useWorldStore((state) => state.quality);
  const reduceMotion = useWorldStore((state) => state.reduceMotion);
  const htmlMode = useWorldStore((state) => state.htmlMode);
  const setQuality = useWorldStore((state) => state.setQuality);
  const setReduceMotion = useWorldStore((state) => state.setReduceMotion);
  const setHtmlMode = useWorldStore((state) => state.setHtmlMode);
  const setDrawer = useWorldStore((state) => state.setDrawer);
  const [stats, setStats] = useState(measure());
  useEffect(() => {
    const timer = window.setInterval(() => setStats(measure()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const options: Array<{ value: Quality; label: string; note: string }> = [
    { value: 'high', label: '高', note: '像素比上限 1.75，2048 阴影，透明玻璃' },
    { value: 'medium', label: '中（默认）', note: '像素比上限 1.25，1024 阴影，无后期处理' },
    { value: 'low', label: '低', note: '像素比 1，无阴影，玻璃改为不透明，走廊补光减半' }
  ];
  return (
    <Drawer title="设置" onClose={() => setDrawer('none')}>
      <fieldset className="setting">
        <legend>画质</legend>
        {options.map((option) => (
          <label key={option.value} className={`radio-row${quality === option.value ? ' on' : ''}`}>
            <input type="radio" name="quality" checked={quality === option.value} onChange={() => setQuality(option.value)} />
            <span><b>{option.label}</b><small>{option.note}</small></span>
          </label>
        ))}
      </fieldset>
      <label className="radio-row">
        <input type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} />
        <span><b>减少动态</b><small>关闭呼吸、脉冲与镜头晃动，缩短镜头过渡；操作能力不变</small></span>
      </label>
      <label className="radio-row">
        <input type="checkbox" checked={htmlMode} onChange={(event) => setHtmlMode(event.target.checked)} />
        <span><b>HTML 实验模式</b><small>不使用三维场景，用同样的字段与接口完成实验</small></span>
      </label>
      <NetworkCheck />
      <section className="perf-box">
        <h3>本机实测（最近 {stats?.samples ?? 0} 帧）</h3>
        {stats ? (
          <dl className="kv">
            <div><dt>平均帧率</dt><dd>{stats.fps.toFixed(1)} fps</dd></div>
            <div><dt>p95 帧时间</dt><dd>{stats.p95.toFixed(1)} ms</dd></div>
            <div><dt>绘制调用</dt><dd>{perf.drawCalls}</dd></div>
            <div><dt>三角形</dt><dd>{perf.triangles.toLocaleString()}</dd></div>
            <div><dt>设备像素比</dt><dd>{window.devicePixelRatio}</dd></div>
          </dl>
        ) : <p className="muted small">采样中…（打开设置时场景仍在后台渲染）</p>}
      </section>
    </Drawer>
  );
}

export function HelpDrawer() {
  const setDrawer = useWorldStore((state) => state.setDrawer);
  return (
    <Drawer title="帮助" onClose={() => setDrawer('none')}>
      <section className="help">
        <h3>操作</h3>
        <ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 方向键：移动（相对当前视角）</li>
          <li>按住鼠标左键拖动：转动视角</li>
          <li><kbd>E</kbd>：在发光圆环附近操作设备（也可点击屏幕上的按钮）</li>
          <li><kbd>H</kbd>：分三层提示——目标、位置、控件说明，不直接给答案</li>
          <li><kbd>Esc</kbd>：关闭面板返回场景</li>
          <li>“自动前往当前任务”：沿门洞与走廊自动走到设备旁</li>
        </ul>
        <h3>规则</h3>
        <ul>
          <li>所有分数由服务端评分；走路、点击设备不加分。</li>
          <li>提交后即使是部分分也可以继续实验；可在反馈后选择重新提交本步。</li>
          <li>已提交的历史步骤只读回看，不会重新评分。</li>
          <li>实时预览来自后端仿真，不含评分；修改已提交的输入后，旧结果标为“上次提交结果”。</li>
          <li>温度曲线、攻击路径均为教学仿真，不连接真实设备、不调用真实工具。</li>
        </ul>
      </section>
      <ProjectInfo />
    </Drawer>
  );
}
