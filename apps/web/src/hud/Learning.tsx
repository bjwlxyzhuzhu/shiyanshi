import { useEffect, useState } from 'react';
import { ABILITY_LEVELS, COURSES, KNOWLEDGE_POINTS, PROJECT_INFO, TEAM, buildCourseAttainment, buildLadder, coursesForStep, knowledgeForStep, type PrelabQuestion, type StepDefinition } from '@zhian/shared';
import { api, type ArchiveItem, type ProcessSummary, type TutorAnswer, type PrelabSummary } from '../api';
import { useSessionStore, useStepInput } from '../stores/session';

const DURING_STEPS = new Set(['S06', 'S08', 'S11', 'S14', 'S16', 'S22']);

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
            <small className="ladder-pos">对标岗位：{ABILITY_LEVELS[index]!.positions.map((item) => item.split('：')[0]).join('、')}</small>
          </div>
          <span className="ladder-state">{level.status}<small>{level.max ? `${Math.round(level.ratio * 100)}%` : '—'} · {level.submitted}/{level.total}</small></span>
        </div>
      ))}
    </div>
  );
}

/** 跨学科学习经历：五门课程关联步骤的得分率 */
export function CourseView() {
  const session = useSessionStore((state) => state.session);
  const items = buildCourseAttainment(session?.stepRecords ?? []);
  return (
    <div className="profile-bars">
      {items.map((item) => (
        <div className="row" key={item.id}>
          <span>{item.name}</span>
          <div className="meter"><i style={{ width: `${Math.round(item.ratio * 100)}%` }} /></div>
          <span>{item.max ? `${Math.round(item.ratio * 100)}% · ${item.stepsDone}/${item.stepsTotal}` : '—'}</span>
        </div>
      ))}
    </div>
  );
}

/** 预习测验：10 道原理题，单独记“预习成绩”，不计入 100 分；可重复作答 */
export function PrelabView() {
  const [questions, setQuestions] = useState<PrelabQuestion[]>([]);
  const [summary, setSummary] = useState<PrelabSummary | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.submitPrelab>> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.prelab().then((data) => { setQuestions(data.questions); setSummary(data.summary); }).catch(() => setError('预习测验暂不可用'));
  }, []);
  const submit = async () => {
    setError(null);
    try {
      const data = await api.submitPrelab(answers);
      setResult(data);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    }
  };
  const summaryText = summary && summary.best !== null ? `最好 ${summary.best}/${summary.total}，最近 ${summary.latest}/${summary.total}（共 ${summary.attempts} 次）` : '尚未作答';
  if (!open) {
    return (
      <div className="confirm">
        <p className="small">{summaryText}。预习成绩单独记录，不计入 24 步的 100 分。</p>
        <button type="button" className="ghost small" disabled={!questions.length} onClick={() => { setOpen(true); setResult(null); setAnswers({}); }}>{summary?.attempts ? '再做一次' : '开始预习测验'}</button>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="prelab" data-block-keys>
      {questions.map((question, index) => {
        const verdict = result?.results.find((item) => item.id === question.id);
        return (
          <fieldset key={question.id} className={verdict ? (verdict.correct ? 'ok' : 'bad') : ''}>
            <legend>{index + 1}. {question.stem}</legend>
            {question.options.map((option, optionIndex) => (
              <label key={option} className={`check${verdict && verdict.answer === optionIndex ? ' answer' : ''}`}>
                <input type="radio" name={question.id} disabled={Boolean(result)} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} />
                {option}
              </label>
            ))}
            {verdict ? <p className="small muted">{verdict.correct ? '正确。' : '错误。'}{verdict.explain}</p> : null}
          </fieldset>
        );
      })}
      {result ? <p className="ok-text">本次得分 {result.correct}/{result.total}。{summaryText}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="confirm">
        {!result ? <button type="button" className="primary" disabled={Object.keys(answers).length < questions.length} onClick={() => void submit()}>提交预习测验</button> : null}
        <button type="button" className="ghost small" onClick={() => setOpen(false)}>{result ? '完成' : '收起'}</button>
      </div>
    </div>
  );
}

/** 研究探索（选做）：提出假设 → 自主设计多组参数 → 依据仿真数据写结论 → 获得趋势反馈 */
export function ExploreView() {
  const session = useSessionStore((state) => state.session);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.explore>> | null>(null);
  const [active, setActive] = useState<string>('E1');
  const [params, setParams] = useState<Record<string, number>>({});
  const [hypothesis, setHypothesis] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.explore().then(setData).catch(() => setError('研究探索暂不可用'));
  useEffect(() => { void load(); }, []);
  const exp = data?.explorations.find((item) => item.id === active);
  const progress = data?.progress.find((item) => item.id === active);
  useEffect(() => {
    if (!exp) return;
    setParams(Object.fromEntries(exp.variables.map((variable) => [variable.key, variable.default])));
    setHypothesis(progress?.report?.hypothesis ?? '');
    setConclusion(progress?.report?.conclusion ?? '');
    setFeedback(progress?.report?.feedback ?? null);
  }, [active, data?.explorations]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !exp) return <p className="muted small">{error ?? '读取中…'}</p>;
  const run = async () => {
    setError(null);
    try {
      await api.runExplore(exp.id, params, session?.sessionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '运行失败');
    }
  };
  const conclude = async () => {
    setError(null);
    try {
      const result = await api.concludeExplore(exp.id, hypothesis, conclusion, session?.sessionId);
      setFeedback(result.feedback);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    }
  };
  const trials = progress?.trials ?? [];
  return (
    <div className="explore" data-block-keys>
      <div className="explore-tabs" role="tablist">
        {data.explorations.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === active} className={item.id === active ? 'on' : ''} onClick={() => setActive(item.id)}>{item.title}</button>
        ))}
      </div>
      <p className="small"><b>研究问题：</b>{exp.question}</p>
      <div className="field">
        <label htmlFor="ex-hyp">我的假设</label>
        <textarea id="ex-hyp" rows={2} value={hypothesis} placeholder="先写下你预期的规律，再用数据检验" onChange={(e) => setHypothesis(e.target.value)} />
      </div>
      <div className="explore-vars">
        {exp.variables.map((variable) => (
          <label key={variable.key} className="field">
            <span className="field-label">{variable.label}{variable.unit ? `（${variable.unit}）` : ''}</span>
            <input type="number" min={variable.min} max={variable.max} step={variable.step} value={params[variable.key] ?? variable.default} onChange={(e) => setParams((current) => ({ ...current, [variable.key]: Number(e.target.value) }))} />
          </label>
        ))}
        <button type="button" className="ghost small" onClick={() => void run()}>运行一组试验</button>
      </div>
      {trials.length ? (
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>#</th>{exp.variables.map((v) => <th key={v.key}>{v.label}</th>)}{exp.metrics.map((m) => <th key={m.key}>{m.label}</th>)}</tr></thead>
            <tbody>
              {trials.map((trial, index) => (
                <tr key={index}><td>{index + 1}</td>{exp.variables.map((v) => <td key={v.key}>{trial.params[v.key]}</td>)}{exp.metrics.map((m) => <td key={m.key}>{trial.metrics[m.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted small">尚未运行试验。至少运行 {data.minTrials} 组不同参数后才能提交结论。</p>}
      <div className="field">
        <label htmlFor="ex-con">依据数据的结论</label>
        <textarea id="ex-con" rows={3} value={conclusion} placeholder="引用你的试验数据说明规律，并回答研究问题" onChange={(e) => setConclusion(e.target.value)} />
      </div>
      <button type="button" className="primary small" onClick={() => void conclude()}>提交结论，获取数据反馈</button>
      {error ? <p className="error-text">{error}</p> : null}
      {feedback ? <pre className="explore-feedback">{feedback}</pre> : null}
      <p className="muted small">研究探索不计入 100 分，试验与结论写入实验报告与过程评价。</p>
    </div>
  );
}

/** 实验数据体系：产业实践数据、学科知识数据、典型实验案例数据（建设标准 1） */
export function DataSystemView() {
  return (
    <dl className="kv">
      <div><dt>产业实践数据</dt><dd>数据中心与设备厂商公开规程（Equinix、华为、NVIDIA、Dell、阿里云、NIST 等 15 项）转化的规则与设备档案；校企课题中企业 MES 质检与人事数据的字段结构；产业技术专家提供的数据安全与个人信息保护监管要求。</dd></div>
      <div><dt>学科知识数据</dt><dd>{KNOWLEDGE_POINTS.length} 个知识点（{COURSES.length} 门课程），每个知识点给出原理与规范依据，关联到具体步骤。</dd></div>
      <div><dt>典型实验案例数据</dt><dd>24 步实验情景与仿真数据集：2000 条产线记录（按企业数据结构程序合成，不含真实个人信息）、200 条投毒检测样本、24 小时 API 调用序列、审计日志、GPU 热路模型参数。</dd></div>
    </dl>
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
          <small>{item.submittedSteps}/24 步 · {item.ladder.map((level) => `${level.id}${level.status}`).join(' ')}{item.teacherReview ? ` · 教师评价：${item.teacherReview.grade}` : ''}</small>
          {item.teacherReview?.comment ? <small className="muted">评语：{item.teacherReview.comment}</small> : null}
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
      <h3>实验数据体系</h3>
      <DataSystemView />
      <h3>项目团队</h3>
      <ul className="team-list">
        {TEAM.map((member) => (
          <li key={member.name}>
            <b>{member.name}</b>
            <span>{member.category === '产业技术专家' ? `产业技术专家 · ${member.org} ${member.position}` : `${member.title}${member.degree ? ` · ${member.degree}` : ''} · 主讲《${member.course?.split('、').join('》《')}》`}</span>
          </li>
        ))}
      </ul>
      <h3>人工智能使用与伦理说明</h3>
      <ul>
        <li>大模型只用于实验指导、仿真数据反馈、反思建议和方案评审，均不计分；成绩全部由确定性评分规则给出。</li>
        <li>发送给模型的内容不含个人信息，也不含评分规则与标准答案；模型输出会过滤手机号、身份证号等个人信息。</li>
        <li>模型不可用时由课程知识库规则兜底，界面如实标注来源；每次模型调用均记录审计，便于伦理审查与核验。</li>
        <li>实验中的企业产线记录、工位图像均为按企业数据结构程序合成的数据，不含任何真实员工或学生信息。</li>
      </ul>
    </section>
  );
}
