import { useEffect, useState } from 'react';
import { ABILITY_LEVELS, COURSES, KNOWLEDGE_POINTS, PROJECT_INFO, TEAM, buildLadder, coursesForStep, knowledgeForStep, type StepDefinition } from '@zhian/shared';
import { api, type ArchiveItem, type ProcessSummary, type TutorAnswer } from '../api';
import { useSessionStore, useStepInput } from '../stores/session';

const DURING_STEPS = new Set(['S06', 'S08', 'S13', 'S17', 'S19', 'S21']);

/** 本步涉及的课程与知识点（多课程融合） */
export function KnowledgeBlock({ step }: { step: StepDefinition }) {
  const points = knowledgeForStep(step.id);
  const courses = coursesForStep(step.id);
  if (!points.length) return null;
  return (
    <details className="material knowledge">
      <summary>
        知识点 {points.length} 个 · {courses.map((course) => <span key={course.id} className="course-chip">{course.name}</span>)}
      </summary>
      <ul className="kp-list">
        {points.map((point) => (
          <li key={point.id}>
            <b>{point.id} {point.name}</b>
            <span>{point.principle}</span>
            {point.reference ? <small>参考：{point.reference}</small> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * AI 实验导师：实验前方案指导与资源推荐 / 实验中仿真数据分析 / 实验后反思与创新路径。
 * 指导不计分；来源（大模型或知识库规则）如实显示。
 */
export function TutorBlock({ step }: { step: StepDefinition }) {
  const session = useSessionStore((state) => state.session);
  const input = useStepInput(step.id);
  const [answer, setAnswer] = useState<TutorAnswer | null>(null);
  const [loading, setLoading] = useState<TutorAnswer['phase'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setAnswer(null);
    setError('');
  }, [step.id]);

  const ask = async (phase: TutorAnswer['phase']) => {
    setLoading(phase);
    setError('');
    try {
      setAnswer(await api.tutor(phase, step.id, input, session?.sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '导师暂时不可用');
    } finally {
      setLoading(null);
    }
  };

  const phases: Array<{ phase: TutorAnswer['phase']; label: string; show: boolean }> = [
    { phase: 'pre', label: '实验前：方案设计指导', show: step.id !== 'S24' },
    { phase: 'during', label: '实验中：分析当前仿真数据', show: DURING_STEPS.has(step.id) },
    { phase: 'post', label: '实验后：反思与改进建议', show: step.id === 'S24' }
  ];

  return (
    <section className="tutor-block">
      <header>
        <h3>AI 实验导师</h3>
        <span className="source-chip muted">指导不计分</span>
      </header>
      <div className="tutor-actions">
        {phases.filter((item) => item.show).map((item) => (
          <button key={item.phase} type="button" className="ghost small" disabled={loading !== null} onClick={() => void ask(item.phase)}>
            {loading === item.phase ? '思考中…' : item.label}
          </button>
        ))}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {answer ? (
        <div className="tutor-answer">
          <span className="source-chip">{answer.source === 'model' ? '来源：大模型' : '来源：课程知识库（规则）'}</span>
          <p>{answer.text}</p>
        </div>
      ) : null}
    </section>
  );
}

export function LadderView() {
  const session = useSessionStore((state) => state.session);
  const ladder = buildLadder(session?.stepRecords ?? []);
  return (
    <div className="ladder">
      {ladder.map((level, index) => (
        <div key={level.id} className={`ladder-row s-${level.status}`}>
          <span className="ladder-id">{level.id}</span>
          <div>
            <b>{level.name}</b>
            <small>{ABILITY_LEVELS[index]!.goal}</small>
          </div>
          <span className="ladder-state">{level.status}<small>{level.max ? `${Math.round(level.ratio * 100)}%` : '—'} · {level.submitted}/{level.total}</small></span>
        </div>
      ))}
    </div>
  );
}

export function ProcessView() {
  const session = useSessionStore((state) => state.session);
  const [data, setData] = useState<ProcessSummary | null>(null);
  useEffect(() => {
    if (session) api.process(session.sessionId).then(setData).catch(() => setData(null));
  }, [session]);
  if (!data) return <p className="muted small">暂无过程数据。</p>;
  return (
    <dl className="kv">
      <div><dt>实际交互步骤</dt><dd>{data.interactionSteps} / 已提交 {data.submittedSteps}</dd></div>
      <div><dt>提交次数</dt><dd>{data.totalAttempts}（重复尝试：{data.retriedSteps.join('、') || '无'}）</dd></div>
      <div><dt>有效操作时长</dt><dd>{data.activeMinutes ?? '—'} 分钟</dd></div>
      <div><dt>提示 / 导师 / 评审</dt><dd>{data.hintsUsed} / {data.tutorRequests} / {data.reviewRequests} 次</dd></div>
    </dl>
  );
}

export function ArchiveView() {
  const [items, setItems] = useState<ArchiveItem[] | null>(null);
  useEffect(() => {
    api.archive().then((data) => setItems(data.sessions)).catch(() => setItems([]));
  }, []);
  if (!items) return <p className="muted small">读取中…</p>;
  if (!items.length) return <p className="muted small">暂无历史实验。</p>;
  const max = Math.max(1, ...items.map((item) => item.totalScore));
  return (
    <ul className="archive-list">
      {items.map((item) => (
        <li key={item.sessionId}>
          <span>{new Date(item.startedAt).toLocaleDateString('zh-CN')}</span>
          <div className="meter"><i style={{ width: `${(item.totalScore / max) * 100}%` }} /></div>
          <b>{item.totalScore}</b>
          <small>{item.submittedSteps}/24 步 · {item.ladder.map((level) => `${level.id}${level.status}`).join(' ')}</small>
        </li>
      ))}
    </ul>
  );
}

/** 网络检测：延迟与下载带宽（服务端提供测试带宽服务） */
export function NetworkCheck() {
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; latency?: number; mbps?: number }>({ status: 'idle' });
  const run = async () => {
    setState({ status: 'running' });
    try {
      const pings: number[] = [];
      for (let i = 0; i < 4; i++) {
        const t0 = performance.now();
        await fetch('/api/net/ping', { cache: 'no-store' });
        pings.push(performance.now() - t0);
      }
      const t0 = performance.now();
      const buffer = await fetch('/api/net/probe?kb=1024', { cache: 'no-store' }).then((r) => r.arrayBuffer());
      const seconds = (performance.now() - t0) / 1000;
      setState({ status: 'done', latency: Math.round(pings.slice(1).reduce((a, b) => a + b, 0) / 3), mbps: Number(((buffer.byteLength * 8) / seconds / 1e6).toFixed(1)) });
    } catch {
      setState({ status: 'error' });
    }
  };
  const verdict = state.mbps === undefined ? '' : state.mbps >= 4 ? '良好' : state.mbps >= 2 ? '可用（首次加载较慢）' : '较差，建议更换网络';
  return (
    <section className="perf-box">
      <h3>网络检测</h3>
      <p className="muted small">首次进入需下载约 1.2 MB 程序资源；建议带宽不低于 4 Mbps、延迟低于 200 ms。</p>
      <button type="button" className="ghost small" disabled={state.status === 'running'} onClick={() => void run()}>{state.status === 'running' ? '检测中…' : '开始检测'}</button>
      {state.status === 'done' ? <p>延迟 {state.latency} ms，下载带宽约 {state.mbps} Mbps：{verdict}</p> : null}
      {state.status === 'error' ? <p className="error-text">检测失败，请检查网络连接。</p> : null}
    </section>
  );
}

export function ProjectInfo() {
  return (
    <section className="help">
      <h3>项目信息</h3>
      <dl className="kv">
        <div><dt>项目名称</dt><dd>{PROJECT_INFO.name}</dd></div>
        <div><dt>申报方向</dt><dd>{PROJECT_INFO.direction}</dd></div>
        <div><dt>实验类型</dt><dd>{PROJECT_INFO.experimentType}（融合 {COURSES.length} 门课程，{KNOWLEDGE_POINTS.length} 个知识点）</dd></div>
        <div><dt>面向学生</dt><dd>{PROJECT_INFO.students.grade} · {PROJECT_INFO.students.majors.map((major) => major.replace(/^\S+\s/, '')).join('、')}</dd></div>
      </dl>
      <h3>项目团队</h3>
      <ul className="team-list">
        {TEAM.map((member) => (
          <li key={member.name}>
            <b>{member.name}</b>
            <span>{member.title}{member.degree ? ` · ${member.degree}` : ''} · 主讲《{member.course}》</span>
          </li>
        ))}
      </ul>
      <h3>人工智能使用与伦理说明</h3>
      <ul>
        <li>大模型只用于实验指导、仿真数据反馈、反思建议和方案评审，均不计分；成绩全部由确定性评分规则给出。</li>
        <li>发送给模型的内容不含个人信息，也不含评分规则与标准答案；模型输出会过滤手机号、身份证号等个人信息。</li>
        <li>模型不可用时由课程知识库规则兜底，界面如实标注来源；每次模型调用均记录审计，便于伦理审查与核验。</li>
        <li>实验中的问卷记录、人像图像均为程序合成数据，不使用真实学生信息。</li>
      </ul>
    </section>
  );
}
