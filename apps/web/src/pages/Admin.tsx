import { useEffect, useMemo, useState } from 'react';
import { BRAND, STUDENT_IMPORT_TEMPLATE, TEACHER_IMPORT_TEMPLATE, defaultTerm, termLabel, type Term } from '@zhian/shared';
import { api, type AdminUser, type AiAuditData, type CourseInput, type CourseItem, type ImportResult, type ModelPreset, type ModelSettings, type ModelTestResult, type ResultRow } from '../api';
import { useSessionStore } from '../stores/session';
import { ChangePassword } from './ChangePassword';

const DEPLOYMENT_OPTIONS = ['公有云服务', '私有化部署', '混合服务', '本地运行'];
const TEACHER_GRADES = ['优秀', '良好', '合格', '不合格'];
const ROLE_LABEL: Record<string, string> = { student: '学生', teacher: '教师', admin: '管理员' };
/** 截至 2026-10-23 的 DeepSeek 文档；仅作填写提示，最终以服务商控制台为准 */
const VERSION_HINT: Record<string, string> = { 'deepseek-flash': 'DeepSeek-V4.1-Flash-1017' };

/** 导出 CSV：UTF-8 BOM 便于 Excel 打开；以 = + - @ 开头的单元格加前缀，防止公式注入 */
function downloadCsv(filename: string, rows: Array<Array<string | number | null>>): void {
  const escape = (value: string | number | null) => {
    let text = value === null ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const blob = new Blob([`﻿${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

// ---------------- 大模型配置 ----------------

function ModelTab() {
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [form, setForm] = useState<Partial<ModelSettings>>({});
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [test, setTest] = useState<ModelTestResult | null>(null);

  useEffect(() => {
    api.admin.model().then((data) => {
      setPresets(data.presets);
      setSettings(data.settings);
      // 从未保存过：按默认服务来源预填地址、模型与提供方
      const first = data.presets.find((item) => item.id === data.settings.preset);
      setForm(data.settings.updatedAt || !first ? data.settings : {
        ...data.settings,
        baseUrl: first.baseUrl ?? '',
        model: first.models[0] ?? '',
        version: VERSION_HINT[first.models[0] ?? ''] ?? '',
        provider: first.provider,
        deployment: first.deployment
      });
    }).catch((error) => setMessage({ tone: 'error', text: errorText(error) }));
  }, []);

  const preset = presets.find((item) => item.id === form.preset);
  const set = (patch: Partial<ModelSettings>) => setForm((current) => ({ ...current, ...patch }));

  const choosePreset = (id: ModelSettings['preset']) => {
    const next = presets.find((item) => item.id === id);
    if (!next) return;
    set({
      preset: id,
      baseUrl: next.baseUrl ?? (form.preset === id ? form.baseUrl : ''),
      provider: next.provider || form.provider,
      deployment: next.deployment,
      model: next.models[0] ?? '',
      version: VERSION_HINT[next.models[0] ?? ''] ?? ''
    });
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { settings: saved } = await api.admin.saveModel({ ...form, apiKey: apiKey || undefined, clearApiKey: clearKey });
      setSettings(saved);
      setForm(saved);
      setApiKey('');
      setClearKey(false);
      setMessage({ tone: 'ok', text: '已保存。密钥已加密存放在服务器，页面不会再显示。' });
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api.admin.testModel());
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="muted">{message?.text ?? '加载中…'}</p>;
  const sourceText = { admin: '管理员配置（本页）', env: '服务器环境变量 AI_*', none: '未接入模型：知识库规则兜底，不计 AI 调用' }[settings.effectiveSource];

  return (
    <div className="admin-section">
      <p className="admin-status">当前生效：<b>{sourceText}</b>{settings.updatedAt ? <span className="muted"> · 最近保存 {new Date(settings.updatedAt).toLocaleString('zh-CN')}</span> : null}</p>
      <div className="form-grid">
        <div className="field wide">
          <label htmlFor="m-preset">服务来源</label>
          <select id="m-preset" value={form.preset} onChange={(e) => choosePreset(e.target.value as ModelSettings['preset'])}>
            {presets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {preset ? <p className="muted small">{preset.note}</p> : null}
        </div>
        <div className="field wide">
          <label htmlFor="m-base">API 地址（OpenAI 兼容，不含 /chat/completions）</label>
          <input id="m-base" value={form.baseUrl ?? ''} placeholder={preset?.baseUrl ?? '请填写服务商控制台给出的 HTTPS 地址，例如 https://…/v1'} onChange={(e) => set({ baseUrl: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="m-model">模型名</label>
          <input id="m-model" list="m-models" value={form.model ?? ''} onChange={(e) => set({ model: e.target.value, version: form.version || VERSION_HINT[e.target.value] || '' })} />
          <datalist id="m-models">{preset?.models.map((model) => <option key={model} value={model} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="m-version">模型版本（回传实验空间用）</label>
          <input id="m-version" value={form.version ?? ''} placeholder={VERSION_HINT[form.model ?? ''] ?? '按服务商文档填写'} onChange={(e) => set({ version: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="m-deploy">部署方式</label>
          <select id="m-deploy" value={form.deployment} onChange={(e) => set({ deployment: e.target.value })}>
            {DEPLOYMENT_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-provider">服务提供方</label>
          <input id="m-provider" value={form.provider ?? ''} onChange={(e) => set({ provider: e.target.value })} />
        </div>
        <div className="field wide">
          <label htmlFor="m-key">API Key（只写不读）</label>
          <input
            id="m-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={clearKey}
            placeholder={settings.apiKeyConfigured ? `已配置（末 4 位 ${settings.apiKeyLast4}），留空则保持不变` : '未配置'}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {settings.apiKeyConfigured ? (
            <label className="check"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> 删除已保存的密钥</label>
          ) : null}
          <p className="muted small">
            密钥以 AES-256-GCM 加密保存在服务器数据库，{settings.keyStorage === 'env_key' ? '加密密钥来自 SETTINGS_ENCRYPTION_KEY' : '加密密钥为服务器数据目录中的 settings.key（备份数据库时请一并妥善保管）'}；
            不进入前端代码、日志或报告。
          </p>
        </div>
        <div className="field wide">
          <label className="check"><input type="checkbox" checked={form.enabled ?? false} onChange={(e) => set({ enabled: e.target.checked })} /> 启用真实大模型（AI 实验导师与安全评审）</label>
        </div>
      </div>
      <div className="admin-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>保存配置</button>
        <button type="button" className="ghost" disabled={busy || settings.effectiveSource === 'none'} onClick={() => void runTest()}>测试连接</button>
      </div>
      {message ? <p className={message.tone === 'ok' ? 'ok-text' : 'error-text'} role="status">{message.text}</p> : null}
      {test ? (
        <dl className="kv admin-test">
          <div><dt>结果</dt><dd>{test.ok ? '连接正常' : '未取得回复'}（{test.state}{test.httpStatus ? `，HTTP ${test.httpStatus}` : ''}）</dd></div>
          <div><dt>耗时</dt><dd>{test.latencyMs} ms</dd></div>
          <div><dt>配置模型 / 实际返回</dt><dd>{test.configuredModel ?? '—'} / {test.providerModel ?? '—'}</dd></div>
          {test.reply ? <div><dt>回复</dt><dd>{test.reply}</dd></div> : null}
        </dl>
      ) : null}
      <div className="note">
        合规提示：发给模型的提示词只含步骤编号、学生对实验参数的选择与系统检测出的风险，不含姓名、学号、班级；
        使用第三方中转站时请求会经过中转方，须经学校同意并在申报材料中如实写明“服务提供方”。测试连接使用固定的无个人信息提示词，记入 AI 审计但不计入任何学生的 AI 调用次数。
      </div>
    </div>
  );
}

// ---------------- 师生导入 ----------------

const IMPORT_KIND = {
  student: { label: '学生', id: '学号', col3: '班级', col4: '专业', template: STUDENT_IMPORT_TEMPLATE, note: '列顺序：学号、姓名、班级、专业。班级须与“学期与课程”中填写的教学班名称一致，学生据此关联到课程。' },
  teacher: { label: '教师', id: '工号', col3: '职称', col4: '院系', template: TEACHER_IMPORT_TEMPLATE, note: '列顺序：工号、姓名、职称、院系。导入后在“学期与课程”中为课程选择任课教师。' }
} as const;

function ImportTab({ kind }: { kind: 'student' | 'teacher' }) {
  const meta = IMPORT_KIND[kind];
  const [text, setText] = useState('');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.admin.importUsers(kind, text, dryRun, updateExisting);
      if (dryRun) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
        setText('');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setPreview(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  const rows = preview?.rows ?? done?.rows ?? [];
  return (
    <div className="admin-section">
      <p className="muted">
        {meta.note}可从 Excel 复制粘贴，或上传“CSV UTF-8”文件。
      </p>
      <div className="admin-actions">
        <button type="button" className="ghost small" onClick={() => downloadCsv(`${meta.label}导入模板.csv`, meta.template.split('\n').map((line) => line.split(',')))}>下载模板</button>
        <label className="ghost small file-button">
          选择 CSV 文件
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
      </div>
      <textarea className="admin-textarea" rows={8} value={text} placeholder={meta.template} onChange={(e) => { setText(e.target.value); setPreview(null); }} data-block-keys />
      <label className="check"><input type="checkbox" checked={updateExisting} onChange={(e) => { setUpdateExisting(e.target.checked); setPreview(null); }} /> 已存在的账号：更新姓名、{meta.col3}、{meta.col4}（不改密码）</label>
      <div className="admin-actions">
        <button type="button" className="ghost" disabled={busy || !text.trim()} onClick={() => void run(true)}>预览检查</button>
        <button type="button" className="primary" disabled={busy || !preview || preview.summary.create + preview.summary.update === 0} onClick={() => void run(false)}>
          确认导入{preview ? `（新建 ${preview.summary.create}、更新 ${preview.summary.update}）` : ''}
        </button>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {done?.credentials?.length ? (
        <div className="credential-box" role="alert">
          <h4>已创建 {done.credentials.length} 个账号 · 初始密码只显示这一次</h4>
          <p className="small">请立即下载并通过安全渠道分发；首次登录时系统会强制修改密码。离开本页后无法再次查看，只能逐个重置。</p>
          <button
            type="button"
            className="primary"
            onClick={() => downloadCsv(`${meta.label}初始密码-${stamp()}.csv`, [[meta.id, '姓名', '初始密码'], ...done.credentials!.map((c) => [c.username, c.name, c.password])])}
          >下载初始密码 CSV</button>
        </div>
      ) : null}
      {done && !done.credentials?.length ? <p className="ok-text">导入完成：更新 {done.summary.update} 个账号。</p> : null}

      {rows.length ? (
        <>
          <p className="small">
            {preview ? '预览' : '结果'}：新建 {(preview ?? done)!.summary.create}，更新 {(preview ?? done)!.summary.update}，跳过 {(preview ?? done)!.summary.skip}，错误 {(preview ?? done)!.summary.error}
          </p>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>行</th><th>{meta.id}</th><th>姓名</th><th>{meta.col3}</th><th>{meta.col4}</th><th>处理</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.line}-${row.username}`} className={`st-${row.status}`}>
                    <td>{row.line}</td><td>{row.username}</td><td>{row.name}</td><td>{row.col3}</td><td>{row.col4}</td>
                    <td>{{ create: '新建', update: '更新', skip: '跳过', error: '错误' }[row.status]}{row.message ? `：${row.message}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------- 账号管理 ----------------

function UsersTab() {
  const me = useSessionStore((state) => state.user);
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const load = () => api.admin.users(role, q).then((data) => setUsers(data.users)).catch((err) => setError(errorText(err)));
  useEffect(() => { void load(); }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-actions">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="角色筛选">
          <option value="">全部角色</option>
          <option value="student">学生</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
        </select>
        <input value={q} placeholder="账号 / 姓名 / 班级 / 院系" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} aria-label="搜索" data-block-keys />
        <button type="button" className="ghost small" onClick={() => void load()}>查询</button>
      </div>
      {issued ? (
        <div className="credential-box" role="alert">
          <h4>{issued.username} 的新初始密码（只显示一次）</h4>
          <p><code>{issued.password}</code></p>
          <p className="small">该账号已被注销登录，下次登录须修改密码。</p>
          <button type="button" className="ghost small" onClick={() => setIssued(null)}>我已转交，关闭</button>
        </div>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>班级 / 职称</th><th>专业 / 院系</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.disabled ? 'st-skip' : ''}>
                <td>{user.username}</td>
                <td>{user.name ?? ''}</td>
                <td>{ROLE_LABEL[user.role]}</td>
                <td>{user.role === 'student' ? user.className ?? '' : user.title ?? ''}</td>
                <td>{user.role === 'student' ? user.major ?? '' : user.department ?? ''}</td>
                <td>{user.external ? '实验空间账号' : user.disabled ? '已停用' : user.mustChangePassword ? '待改初始密码' : '正常'}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '—'}</td>
                <td className="row-actions">
                  {!user.external && user.id !== me?.id ? (
                    <button type="button" className="ghost small" onClick={() => void act(async () => setIssued(await api.admin.resetPassword(user.id)))}>重置密码</button>
                  ) : null}
                  {user.role !== 'admin' ? (
                    <button type="button" className="ghost small" onClick={() => void act(() => api.admin.setDisabled(user.id, !user.disabled))}>{user.disabled ? '启用' : '停用'}</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">最多显示 1000 条；姓名、班级等个人信息只保存在本校服务器，不发送给大模型。</p>
    </div>
  );
}

// ---------------- 学生成绩 ----------------

function ResultsTab() {
  const [className, setClassName] = useState('');
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { api.admin.courses().then((data) => setCourses(data.courses)).catch(() => setCourses([])); }, []);
  const [data, setData] = useState<{ bankVersion: string; totalSteps: number; classes: string[]; results: ResultRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ sessionId: number; grade: string; comment: string } | null>(null);
  const load = () => api.admin.results(className, courseId).then(setData).catch((err) => setError(errorText(err)));
  useEffect(() => { void load(); }, [className, courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveReview = async () => {
    if (!editing) return;
    try {
      await api.admin.review(editing.sessionId, editing.grade, editing.comment);
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rows = data?.results ?? [];
  const finished = useMemo(() => rows.filter((row) => row.finishedAt), [rows]);
  const average = finished.length ? (finished.reduce((sum, row) => sum + Number(row.totalScore), 0) / finished.length).toFixed(1) : '—';

  return (
    <div className="admin-section">
      <div className="admin-actions">
        <select value={courseId ?? ''} onChange={(e) => { setCourseId(e.target.value ? Number(e.target.value) : null); setClassName(''); }} aria-label="课程">
          <option value="">{courses.length ? '全部课程' : '本学期暂无课程'}</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}（{course.code}）</option>)}
        </select>
        <select value={className} onChange={(e) => setClassName(e.target.value)} aria-label="班级">
          <option value="">全部班级</option>
          {data?.classes.map((item) => <option key={item}>{item}</option>)}
        </select>
        <button
          type="button"
          className="ghost small"
          disabled={!rows.length}
          onClick={() => downloadCsv(`实验成绩-${className || '全部'}-${stamp()}.csv`, [
            ['账号', '姓名', '班级', '专业', '会话', '来源', '开始时间', '完成时间', '已提交步骤', '操作成绩', '预习成绩（满分 10）', '教师评价', '教师评语', '旧版题库步骤'],
            ...rows.map((row) => [row.username, row.name, row.className, row.major, row.sessionId, row.source, row.startedAt, row.finishedAt, row.stepsDone, Number(row.totalScore).toFixed(1), row.prelabBest, row.teacherGrade, row.teacherComment, row.legacySteps])
          ])}
        >导出 CSV</button>
      </div>
      <p className="small">会话 {rows.length} 个，已完成 {finished.length} 个，完成者平均分 {average}。当前题库版本 {data?.bankVersion ?? '—'}；含旧版题库步骤的会话不宜与新版直接比较。</p>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>账号</th><th>姓名</th><th>班级</th><th>专业</th><th>开始</th><th>进度</th><th>操作成绩</th><th>预习</th><th>教师评价</th><th>备注</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sessionId}>
                <td>{row.username}</td><td>{row.name}</td><td>{row.className ?? ''}</td><td>{row.major ?? ''}</td>
                <td>{new Date(row.startedAt).toLocaleString('zh-CN')}</td>
                <td>{row.finishedAt ? '已完成' : `${row.stepsDone} / ${data?.totalSteps ?? 24}`}</td>
                <td>{Number(row.totalScore).toFixed(1)}</td>
                <td>{row.prelabBest ?? '—'}</td>
                <td>
                  {editing?.sessionId === row.sessionId ? (
                    <div className="review-editor">
                      <select value={editing.grade} onChange={(e) => setEditing({ ...editing, grade: e.target.value })} aria-label="评价等级">
                        {TEACHER_GRADES.map((grade) => <option key={grade}>{grade}</option>)}
                      </select>
                      <textarea value={editing.comment} maxLength={500} placeholder="评语（可选，500 字以内）" onChange={(e) => setEditing({ ...editing, comment: e.target.value })} />
                      <div className="row-actions">
                        <button type="button" className="primary small" onClick={() => void saveReview()}>保存</button>
                        <button type="button" className="ghost small" onClick={() => setEditing(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="ghost small" title={row.teacherComment ?? ''} onClick={() => setEditing({ sessionId: row.sessionId, grade: row.teacherGrade ?? '良好', comment: row.teacherComment ?? '' })}>
                      {row.teacherGrade ?? '评价'}
                    </button>
                  )}
                </td>
                <td>{[row.source === 'ilab' ? '实验空间' : row.source === 'synthetic' ? '合成演示' : '', row.legacySteps ? `含旧版题库 ${row.legacySteps} 步` : ''].filter(Boolean).join('；')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- 学期与课程 ----------------

const EMPTY_COURSE = (term: Term): CourseInput => ({ code: '', name: '', category: '', termStartYear: term.startYear, termNo: term.termNo, totalHours: '', credits: '', teacherIds: [], classes: '' });

function CoursesTab({ editable }: { editable: boolean }) {
  const [term, setTerm] = useState<Term>(defaultTerm());
  const [current, setCurrent] = useState<Term | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<CourseInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => now - 5 + index);
  }, []);

  const load = (target: Term) => api.admin.courses(target).then((data) => setCourses(data.courses)).catch((err) => setMessage({ tone: 'error', text: errorText(err) }));
  useEffect(() => {
    api.admin.term().then((data) => { setCurrent(data.term); setTerm(data.term); void load(data.term); }).catch((err) => setMessage({ tone: 'error', text: errorText(err) }));
    if (editable) api.admin.users('teacher', '').then((data) => setTeachers(data.users.filter((user) => !user.disabled))).catch(() => undefined);
  }, [editable]);

  const changeTerm = (next: Term) => {
    setTerm(next);
    setForm(null);
    void load(next);
  };

  const setCurrentTerm = async () => {
    try {
      const data = await api.admin.saveTerm(term);
      setCurrent(data.term);
      setMessage({ tone: 'ok', text: `当前学期已设为 ${data.label}` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    }
  };

  const save = async () => {
    if (!form) return;
    try {
      await api.admin.saveCourse(editingId, form);
      setMessage({ tone: 'ok', text: editingId ? '课程已更新' : '课程已创建' });
      setForm(null);
      setEditingId(null);
      await load(term);
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    }
  };

  const edit = (course: CourseItem) => {
    setEditingId(course.id);
    setForm({ code: course.code, name: course.name, category: course.category, termStartYear: course.termStartYear, termNo: course.termNo, totalHours: course.totalHours ?? '', credits: course.credits ?? '', teacherIds: course.teachers.map((t) => t.id), classes: course.classes.join('，') });
  };

  const remove = async (course: CourseItem) => {
    if (!window.confirm(`删除课程“${course.name}（${course.code}）”？学生与教师账号不受影响。`)) return;
    try {
      await api.admin.deleteCourse(course.id);
      await load(term);
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    }
  };

  const set = (patch: Partial<CourseInput>) => setForm((value) => (value ? { ...value, ...patch } : value));

  return (
    <div className="admin-section">
      <div className="admin-actions">
        <label className="field-inline">学年
          <select value={term.startYear} onChange={(e) => changeTerm({ ...term, startYear: Number(e.target.value) })}>
            {years.map((year) => <option key={year} value={year}>{year}—{year + 1}</option>)}
          </select>
        </label>
        <label className="field-inline">学期
          <select value={term.termNo} onChange={(e) => changeTerm({ ...term, termNo: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>第一学期</option>
            <option value={2}>第二学期</option>
          </select>
        </label>
        {editable ? (
          <button type="button" className="ghost small" disabled={current?.startYear === term.startYear && current?.termNo === term.termNo} onClick={() => void setCurrentTerm()}>设为当前学期</button>
        ) : null}
        <span className="muted small">当前学期：{current ? termLabel(current) : '—'}</span>
      </div>
      <p className="muted small">课程、任课教师与教学班三者关联：学生按导入时填写的班级自动归入教学班；教师在“学生成绩”中只能看到自己任课教学班的学生。</p>
      {message ? <p className={message.tone === 'ok' ? 'ok-text' : 'error-text'} role="status">{message.text}</p> : null}
      {editable && !form ? <div className="admin-actions"><button type="button" className="primary" onClick={() => { setEditingId(null); setForm(EMPTY_COURSE(term)); }}>新建课程</button></div> : null}
      {form ? (
        <div className="course-form">
          <div className="form-grid">
            <div className="field"><label htmlFor="c-code">课程序号</label><input id="c-code" value={form.code} placeholder="如 25224902.03" onChange={(e) => set({ code: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-name">课程名称</label><input id="c-name" value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-cat">课程类别</label><input id="c-cat" value={form.category} placeholder="如 学科基础选修课" onChange={(e) => set({ category: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-term">学期</label>
              <select id="c-term" value={`${form.termStartYear}-${form.termNo}`} onChange={(e) => { const [y, n] = e.target.value.split('-').map(Number); set({ termStartYear: y!, termNo: n as 1 | 2 }); }}>
                {years.flatMap((year) => [1, 2].map((no) => <option key={`${year}-${no}`} value={`${year}-${no}`}>{termLabel({ startYear: year, termNo: no as 1 | 2 })}</option>))}
              </select>
            </div>
            <div className="field"><label htmlFor="c-hours">总课时</label><input id="c-hours" type="number" min={0} value={form.totalHours ?? ''} onChange={(e) => set({ totalHours: e.target.value === '' ? '' : Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="c-credits">学分</label><input id="c-credits" type="number" min={0} step={0.5} value={form.credits ?? ''} onChange={(e) => set({ credits: e.target.value === '' ? '' : Number(e.target.value) })} /></div>
            <div className="field wide"><label htmlFor="c-classes">教学班（多个用逗号或顿号分隔，须与学生导入时的班级名称一致）</label>
              <textarea id="c-classes" className="admin-textarea" rows={2} value={form.classes} placeholder="2025级人工智能1班，2025级人工智能2班" onChange={(e) => set({ classes: e.target.value })} />
            </div>
            <div className="field wide"><span className="field-label">任课教师（可多选）</span>
              <div className="teacher-picks">
                {teachers.length ? teachers.map((teacher) => (
                  <label key={teacher.id} className="check">
                    <input type="checkbox" checked={form.teacherIds.includes(teacher.id)} onChange={(e) => set({ teacherIds: e.target.checked ? [...form.teacherIds, teacher.id] : form.teacherIds.filter((id) => id !== teacher.id) })} />
                    {teacher.name ?? teacher.username}（{teacher.username}）
                  </label>
                )) : <span className="muted small">尚未导入教师，请先在“教师导入”中导入。</span>}
              </div>
            </div>
          </div>
          <div className="admin-actions">
            <button type="button" className="primary" onClick={() => void save()}>{editingId ? '保存修改' : '创建课程'}</button>
            <button type="button" className="ghost" onClick={() => { setForm(null); setEditingId(null); }}>取消</button>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>课程序号</th><th>课程名称</th><th>类别</th><th>教学班</th><th>任课教师</th><th>总课时</th><th>学分</th><th>已导入学生</th>{editable ? <th>操作</th> : null}</tr></thead>
          <tbody>
            {courses.length ? courses.map((course) => (
              <tr key={course.id}>
                <td>{course.code}</td><td>{course.name}</td><td>{course.category}</td>
                <td className="wrap">{course.classes.join('、')}</td>
                <td>{course.teachers.map((t) => t.name).join('、')}</td>
                <td>{course.totalHours ?? '—'}</td><td>{course.credits ?? '—'}</td><td>{course.students}</td>
                {editable ? (
                  <td className="row-actions">
                    <button type="button" className="ghost small" onClick={() => edit(course)}>编辑</button>
                    <button type="button" className="ghost small" onClick={() => void remove(course)}>删除</button>
                  </td>
                ) : null}
              </tr>
            )) : <tr><td colSpan={editable ? 9 : 8} className="muted">{termLabel(term)}暂无课程</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- AI 审计与伦理 ----------------

const SCENARIO_NAME: Record<string, string> = {
  'tutor:pre': 'AI 导师 · 实验前',
  'tutor:during': 'AI 导师 · 实验中',
  'tutor:post': 'AI 导师 · 实验后',
  'admin:connectivity_test': '管理员连接测试'
};

function AuditTab() {
  const [data, setData] = useState<AiAuditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.admin.aiAudit().then(setData).catch((err) => setError(errorText(err))); }, []);
  if (!data) return <p className="muted">{error ?? '加载中…'}</p>;
  const { fairness } = data;
  return (
    <div className="admin-section">
      <p className="muted">本页是“伦理安全、可信可控”的运行证据：模型调用是否真实发生、失败时是否规则兜底、输出是否触发个人信息过滤，以及按专业的成绩差异监测。成绩全部由确定性规则给出，大模型不参与打分。</p>
      <h4>模型调用（按场景）</h4>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>场景</th><th>调用</th><th>收到响应</th><th>失败</th><th>未配置</th><th>规则兜底</th><th>输入 / 输出 token</th></tr></thead>
          <tbody>
            {data.byScenario.length ? data.byScenario.map((row) => (
              <tr key={row.scenario}>
                <td>{SCENARIO_NAME[row.scenario] ?? (row.scenario.startsWith('review:') ? `安全助手评审 ${row.scenario.slice(7)}` : row.scenario || '—')}</td>
                <td>{row.calls}</td><td>{row.received}</td><td>{row.failed}</td><td>{row.notConfigured}</td><td>{row.ruleFallback}</td>
                <td>{row.promptTokens} / {row.completionTokens}</td>
              </tr>
            )) : <tr><td colSpan={7} className="muted">暂无调用记录</td></tr>}
          </tbody>
        </table>
      </div>
      <h4>AI 导师输出</h4>
      <p className="small">共 {data.tutor.total} 条指导，其中来自大模型 {data.tutor.fromModel} 条；触发个人信息过滤（手机号、身份证号等被替换为“[已过滤]”）{data.tutor.filtered} 条。</p>
      <h4>算法公平性监测（按专业比较已完成实验的平均分）</h4>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>专业</th><th>完成人次</th><th>平均分</th></tr></thead>
          <tbody>
            {fairness.groups.length ? fairness.groups.map((group) => (
              <tr key={group.major} className={group.n < fairness.minGroupSize ? 'st-skip' : ''}><td>{group.major}</td><td>{group.n}</td><td>{group.mean}</td></tr>
            )) : <tr><td colSpan={3} className="muted">暂无已完成的实验</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={`small${fairness.flagged ? ' flag-warn' : ''}`}>
        {fairness.gap === null
          ? `每组完成人次达到 ${fairness.minGroupSize} 后开始比较（灰色行样本不足）。`
          : fairness.flagged
            ? `组间平均分差 ${fairness.gap} 分，超过 ${fairness.threshold} 分：请教学团队复核是否存在题目表述、先修知识或评分规则对某专业不利的情况，并记录复核结论。`
            : `组间平均分差 ${fairness.gap} 分，未超过 ${fairness.threshold} 分的复核线。`}
      </p>
    </div>
  );
}

// ---------------- 外框 ----------------

type Tab = 'courses' | 'students' | 'teachers' | 'model' | 'users' | 'results' | 'audit';

export function Admin() {
  const user = useSessionStore((state) => state.user);
  const setPage = useSessionStore((state) => state.setPage);
  const logout = useSessionStore((state) => state.logout);
  const isAdmin = user?.role === 'admin';
  const tabs: Array<{ id: Tab; label: string }> = isAdmin
    ? [{ id: 'courses', label: '学期与课程' }, { id: 'students', label: '学生导入' }, { id: 'teachers', label: '教师导入' }, { id: 'users', label: '账号管理' }, { id: 'results', label: '学生成绩' }, { id: 'model', label: '大模型配置' }, { id: 'audit', label: 'AI 审计与伦理' }]
    : [{ id: 'courses', label: '我的课程' }, { id: 'results', label: '学生成绩' }];
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  const [changing, setChanging] = useState(false);

  if (changing) return <ChangePassword forced={false} onDone={() => setChanging(false)} />;

  return (
    <div className="admin-layer" data-block-keys>
      <header className="admin-top">
        <div className="hud-brand"><span className="brand-mark" aria-hidden>安</span><strong>{BRAND.name}</strong><span className="hud-crumb">{isAdmin ? '管理后台' : '教师后台'}</span></div>
        <div className="html-top-actions">
          <span className="muted">{user?.username} · {ROLE_LABEL[user?.role ?? ''] ?? ''}</span>
          <button type="button" className="ghost" onClick={() => setChanging(true)}>修改密码</button>
          <button type="button" className="ghost" onClick={() => setPage('experiment')}>返回实验</button>
          <button type="button" className="ghost" onClick={logout}>退出</button>
        </div>
      </header>
      <nav className="admin-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </nav>
      <main className="admin-main">
        {tab === 'model' ? <ModelTab /> : null}
        {tab === 'courses' ? <CoursesTab editable={isAdmin} /> : null}
        {tab === 'students' ? <ImportTab key="students" kind="student" /> : null}
        {tab === 'teachers' ? <ImportTab key="teachers" kind="teacher" /> : null}
        {tab === 'users' ? <UsersTab /> : null}
        {tab === 'results' ? <ResultsTab /> : null}
        {tab === 'audit' ? <AuditTab /> : null}
      </main>
    </div>
  );
}
