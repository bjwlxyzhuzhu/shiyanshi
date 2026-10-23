import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BANK_VERSION, STEPS } from '@zhian/shared';
import { db, hashPassword } from '../src/db.js';
import { setModelFetch } from '../src/ilab/aiAudit.js';
import { parseTable } from '../src/routes/admin.js';
import { api, changedInput, configure, startServer, type Harness } from './harness.js';

// 测试专用的合成账号与合成密钥，不是任何真实凭据
const ADMIN_PW = 'SyntheticAdmin2026';
const TEACHER_PW = 'SyntheticTeacher2026';
const FAKE_KEY = 'sk-synthetic-test-key-0000-abcd';

let h: Harness;

function createUser(username: string, role: string, password: string): void {
  db.prepare('INSERT INTO users (username, password_hash, role, points, created_at) VALUES (?, ?, ?, 0, ?)').run(username, hashPassword(password), role, new Date().toISOString());
}

async function login(username: string, password: string) {
  const res = await fetch(`${h.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return { status: res.status, json: await res.json() as any };
}

async function put(token: string, path: string, body: unknown) {
  const res = await fetch(`${h.base}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() as any, text: '' };
}

let adminToken = '';
let teacherToken = '';

beforeAll(async () => {
  for (const key of Object.keys(process.env)) if (key.startsWith('AI_')) delete process.env[key];
  configure();
  h = await startServer();
  createUser('t_admin', 'admin', ADMIN_PW);
  createUser('t_teacher', 'teacher', TEACHER_PW);
  adminToken = (await login('t_admin', ADMIN_PW)).json.token;
  teacherToken = (await login('t_teacher', TEACHER_PW)).json.token;
});
afterAll(() => h.close());
afterEach(() => setModelFetch(() => Promise.reject(new TypeError('BLOCKED'))));

describe('管理员配置真实大模型（密钥只写不读）', () => {
  it('仅管理员可访问；教师 403', async () => {
    expect((await api(h.base, teacherToken).get('/api/admin/model')).status).toBe(403);
    const res = await api(h.base, adminToken).get('/api/admin/model');
    expect(res.status).toBe(200);
    expect(res.json.presets.map((p: { id: string }) => p.id)).toEqual(['deepseek_official', 'tokenone_relay', 'custom']);
    // 中转站地址不预置、不猜测
    expect(res.json.presets.find((p: { id: string }) => p.id === 'tokenone_relay').baseUrl).toBeNull();
    expect(res.json.settings.effectiveSource).toBe('none');
  });

  it('启用前必须有地址、模型与密钥；只接受 HTTPS', async () => {
    const noKey = await put(adminToken, '/api/admin/model', { enabled: true, preset: 'deepseek_official', model: 'deepseek-flash' });
    expect(noKey.status).toBe(400);
    expect(noKey.json.field).toBe('apiKey');
    const http = await put(adminToken, '/api/admin/model', { enabled: false, preset: 'custom', baseUrl: 'http://relay.example.com/v1' });
    expect(http.status).toBe(400);
    expect(http.json.field).toBe('baseUrl');
  });

  it('保存后只返回“已配置 + 末 4 位”，数据库中为密文', async () => {
    const saved = await put(adminToken, '/api/admin/model', { enabled: true, preset: 'deepseek_official', model: 'deepseek-flash', version: 'DeepSeek-V4.1-Flash-1017', apiKey: FAKE_KEY });
    expect(saved.status).toBe(200);
    expect(saved.json.settings).toMatchObject({ enabled: true, baseUrl: 'https://api.deepseek.com', apiKeyConfigured: true, apiKeyLast4: 'abcd', effectiveSource: 'admin', deployment: '公有云服务' });
    const read = await api(h.base, adminToken).get('/api/admin/model');
    expect(read.text).not.toContain(FAKE_KEY);
    expect(JSON.stringify(saved.json)).not.toContain(FAKE_KEY);
    const stored = db.prepare("SELECT value_json FROM app_settings WHERE key = 'ai_model'").get() as { value_json: string };
    expect(stored.value_json).not.toContain(FAKE_KEY);
    const audit = db.prepare("SELECT detail_json FROM admin_audit WHERE action = 'model_settings.update'").all() as Array<{ detail_json: string }>;
    expect(audit.map((row) => row.detail_json).join('')).not.toContain(FAKE_KEY);
    // 不填密钥再保存：保持原密钥
    const again = await put(adminToken, '/api/admin/model', { enabled: true, preset: 'deepseek_official', model: 'deepseek-v4-pro', version: 'x' });
    expect(again.json.settings.apiKeyConfigured).toBe(true);
  });

  it('连通性测试使用管理员配置的地址与密钥，记入审计但不关联实验会话', async () => {
    const seen: Array<{ url: string; auth: string; model: string }> = [];
    setModelFetch(async (url, init) => {
      seen.push({ url, auth: String((init?.headers as Record<string, string>).Authorization), model: JSON.parse(String(init?.body)).model });
      return new Response(JSON.stringify({ model: 'deepseek-v4-pro', choices: [{ message: { content: '连接正常' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const res = await api(h.base, adminToken).post('/api/admin/model/test');
    expect(res.json).toMatchObject({ ok: true, state: 'response_received', httpStatus: 200, reply: '连接正常' });
    expect(res.text).not.toContain(FAKE_KEY);
    expect(seen).toEqual([{ url: 'https://api.deepseek.com/chat/completions', auth: `Bearer ${FAKE_KEY}`, model: 'deepseek-v4-pro' }]);
    const row = db.prepare("SELECT session_id, configured_model, deployment FROM ai_invocations WHERE scenario = 'admin:connectivity_test'").get() as { session_id: number | null; configured_model: string; deployment: string };
    expect(row).toEqual({ session_id: null, configured_model: 'deepseek-v4-pro', deployment: '公有云服务' });
  });

  it('TokenONE 中转：由管理员填写地址；末尾的 /chat/completions 会被规整掉', async () => {
    const saved = await put(adminToken, '/api/admin/model', { enabled: true, preset: 'tokenone_relay', baseUrl: 'https://relay.example.test/v1/chat/completions', model: 'deepseek-chat' });
    expect(saved.json.settings).toMatchObject({ baseUrl: 'https://relay.example.test/v1', provider: 'TokenONE 中转（上游 DeepSeek）', apiKeyConfigured: true });
    const cleared = await put(adminToken, '/api/admin/model', { enabled: false, preset: 'tokenone_relay', baseUrl: 'https://relay.example.test/v1', model: 'deepseek-chat', clearApiKey: true });
    expect(cleared.json.settings).toMatchObject({ apiKeyConfigured: false, effectiveSource: 'none' });
  });
});

describe('管理员导入师生名单', () => {
  const sheet = [
    '学号,姓名,班级,专业',
    '2026010101,合成学生甲,机械2601,机械设计制造及其自动化',
    '2026010102,"合成学生乙",材控2601,材料成型及控制工程',
    'x,太短,机械2601,',
    '2026010101,重复行,机械2601,',
    '2026010103,缺班级,,'
  ].join('\n');

  it('解析 CSV / 制表符 / 中文逗号', () => {
    expect(parseTable('a，b，"c,d"\n1\t2\t3')).toEqual([['a', 'b', 'c,d'], ['1', '2', '3']]);
  });

  it('学生与教师分开导入：必须指定类型；预览不写库，逐行给出问题', async () => {
    expect((await api(h.base, adminToken).post('/api/admin/users/import', { text: sheet, dryRun: true })).json.code).toBe('BAD_KIND');
    const res = await api(h.base, adminToken).post('/api/admin/users/import', { kind: 'student', text: sheet, dryRun: true });
    expect(res.json.summary).toEqual({ create: 2, update: 0, skip: 0, error: 3 });
    expect(res.json.rows.find((row: { username: string }) => row.username === '2026010103').message).toContain('班级');
    expect(res.json.credentials).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS c FROM users WHERE username = '2026010101'").get()).toEqual({ c: 0 });
  });

  it('确认导入后一次性返回初始密码；首次登录必须改密，改密后可做实验', async () => {
    const res = await api(h.base, adminToken).post('/api/admin/users/import', { kind: 'student', text: sheet, dryRun: false });
    expect(res.json.credentials).toHaveLength(2);
    const student = res.json.credentials.find((c: { username: string }) => c.username === '2026010101');
    expect(student.password).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{12}$/);
    const stored = db.prepare("SELECT password_hash, display_name, class_name, major, must_change_password FROM users WHERE username = '2026010101'").get() as Record<string, unknown>;
    expect(stored).toMatchObject({ display_name: '合成学生甲', class_name: '机械2601', must_change_password: 1 });
    expect(String(stored.password_hash)).not.toContain(student.password);

    const first = await login('2026010101', student.password);
    expect(first.json.user).toMatchObject({ role: 'student', mustChangePassword: true, username: '合成学生甲' });
    const client = api(h.base, first.json.token);
    expect((await client.post('/api/experiment/start')).json.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await client.get('/api/auth/me')).status).toBe(200);

    const weak = await client.post('/api/auth/change-password', { oldPassword: student.password, newPassword: '12345678' });
    expect(weak.status).toBe(400);
    expect(weak.json.code).toBe('WEAK_PASSWORD');
    const ok = await client.post('/api/auth/change-password', { oldPassword: student.password, newPassword: 'MyNewSecret2026' });
    expect(ok.json.ok).toBe(true);
    const started = await client.post('/api/experiment/start');
    expect(started.status).toBe(200);

    // 新记录带题库版本
    const step = STEPS[0]!;
    await client.post(`/api/experiment/${started.json.sessionId}/step/${step.id}`, { input: changedInput(step) });
    const records = await client.get(`/api/experiment/${started.json.sessionId}/records`);
    expect(records.json.bankVersion).toBe(BANK_VERSION);
    expect(records.json.records[0].bankVersion).toBe(BANK_VERSION);
  });

  it('再次导入：已存在账号默认跳过；勾选更新时只改姓名班级专业，不改密码', async () => {
    const before = db.prepare("SELECT password_hash FROM users WHERE username = '2026010102'").get() as { password_hash: string };
    const res = await api(h.base, adminToken).post('/api/admin/users/import', { kind: 'student', text: '2026010102,合成学生乙,材控2602,材料成型及控制工程', dryRun: false, updateExisting: true });
    expect(res.json.summary.update).toBe(1);
    expect(res.json.credentials).toHaveLength(0);
    const after = db.prepare("SELECT password_hash, class_name FROM users WHERE username = '2026010102'").get() as { password_hash: string; class_name: string };
    expect(after).toEqual({ password_hash: before.password_hash, class_name: '材控2602' });
  });

  it('停用账号：不能登录，已有登录立即失效；重置密码后须再次改密', async () => {
    const created = await api(h.base, adminToken).post('/api/admin/users/import', { kind: 'student', text: '2026010199,合成学生丙,机械2601,机械设计制造及其自动化', dryRun: false });
    const cred = created.json.credentials[0];
    const session = await login(cred.username, cred.password);
    const id = session.json.user.id;
    await api(h.base, adminToken).post(`/api/admin/users/${id}/status`, { disabled: true });
    expect((await api(h.base, session.json.token).get('/api/auth/me')).status).toBe(401);
    expect((await login(cred.username, cred.password)).status).toBe(403);
    await api(h.base, adminToken).post(`/api/admin/users/${id}/status`, { disabled: false });
    const reset = await api(h.base, adminToken).post(`/api/admin/users/${id}/reset-password`);
    expect(reset.json.password).not.toBe(cred.password);
    expect((await login(cred.username, reset.json.password)).json.user.mustChangePassword).toBe(true);
  });

  it('学生不能访问后台；教师可查看成绩但不能导入', async () => {
    const student = await login('2026010101', 'MyNewSecret2026');
    expect((await api(h.base, student.json.token).get('/api/admin/results')).status).toBe(403);
    expect((await api(h.base, teacherToken).post('/api/admin/users/import', { kind: 'student', text: 'a01,x,班1' })).status).toBe(403);
    // 未关联课程的教师看不到任何学生
    expect((await api(h.base, teacherToken).get('/api/admin/results')).json.results).toEqual([]);
    const teacherId = (db.prepare("SELECT id FROM users WHERE username = 't_teacher'").get() as { id: number }).id;
    const course = await api(h.base, adminToken).post('/api/admin/courses', { code: '25224902.03', name: '实验室安全', category: '学科基础选修课', termStartYear: 2026, termNo: 1, totalHours: 16, credits: 1, teacherIds: [teacherId], classes: '机械2601' });
    expect(course.json.course).toMatchObject({ students: 2, termLabel: '2026—2027 学年第一学期' });
    expect((await api(h.base, teacherToken).get('/api/admin/results?className=材控2601')).json.results).toEqual([]);
    const results = await api(h.base, teacherToken).get('/api/admin/results?className=机械2601');
    expect(results.status).toBe(200);
    expect(results.json.results[0]).toMatchObject({ username: '2026010101', className: '机械2601', stepsDone: 1, legacySteps: 0 });
  });
});

describe('教师导入、学期与课程关联', () => {
  it('教师单独导入，保存职称与院系', async () => {
    const res = await api(h.base, adminToken).post('/api/admin/users/import', { kind: 'teacher', text: '工号,姓名,职称,院系\nT2026001,合成教师乙,副教授,计算机学院', dryRun: false });
    expect(res.json.credentials).toHaveLength(1);
    expect(db.prepare("SELECT role, title, department FROM users WHERE username = 'T2026001'").get()).toEqual({ role: 'teacher', title: '副教授', department: '计算机学院' });
  });

  it('学期按“某学年第一/第二学期”设置；课程序号在同一学期内唯一；任课教师须为教师账号', async () => {
    expect((await put(adminToken, '/api/admin/term', { startYear: 2026, termNo: 3 })).status).toBe(400);
    expect((await put(adminToken, '/api/admin/term', { startYear: 2026, termNo: 2 })).json.label).toBe('2026—2027 学年第二学期');
    const studentId = (db.prepare("SELECT id FROM users WHERE username = '2026010101'").get() as { id: number }).id;
    const otherTeacherId = (db.prepare("SELECT id FROM users WHERE username = 'T2026001'").get() as { id: number }).id;
    const badTeacher = await api(h.base, adminToken).post('/api/admin/courses', { code: 'X1', name: '课', termStartYear: 2026, termNo: 2, teacherIds: [studentId], classes: '班1' });
    expect(badTeacher.json.field).toBe('teacherIds');
    const dup = await api(h.base, adminToken).post('/api/admin/courses', { code: '25224902.03', name: '实验室安全', termStartYear: 2026, termNo: 1, teacherIds: [otherTeacherId], classes: ['班1'] });
    expect(dup.status).toBe(409);
    const own = await api(h.base, adminToken).post('/api/admin/courses', { code: '1996101215.01', name: '前沿技术与学科发展讲座', termStartYear: 2026, termNo: 1, teacherIds: [otherTeacherId], classes: '班1，班2' });
    expect(own.json.course.classes).toEqual(['班1', '班2']);
  });

  it('教师只看到自己任课的课程；管理员看到本学期全部课程', async () => {
    const mine = await api(h.base, teacherToken).get('/api/admin/courses?startYear=2026&termNo=1');
    expect(mine.json.courses.map((c: { name: string }) => c.name)).toEqual(['实验室安全']);
    const all = await api(h.base, adminToken).get('/api/admin/courses?startYear=2026&termNo=1');
    expect(all.json.courses).toHaveLength(2);
    expect(all.json.label).toBe('2026—2027 学年第一学期');
  });
});

describe('国家级评审整改：预习成绩、教师评价、跨学科、伦理审计', () => {
  it('预习测验：题目不含答案；未答完不收；判分后给出解析并记录最好成绩', async () => {
    const student = await login('2026010101', 'MyNewSecret2026');
    const client = api(h.base, student.json.token);
    const got = await client.get('/api/learning/prelab');
    expect(got.json.questions).toHaveLength(10);
    expect(got.text).not.toMatch(/"answer"|explain/);
    expect((await client.post('/api/learning/prelab', { answers: { Q01: 2 } })).status).toBe(400);
    const { PRELAB_KEY } = await import('../src/prelabKey.js');
    const all = Object.fromEntries(Object.entries(PRELAB_KEY).map(([id, key]) => [id, key.answer]));
    const wrongOne = { ...all, Q01: (all.Q01! + 1) % 4 };
    const first = await client.post('/api/learning/prelab', { answers: wrongOne });
    expect(first.json).toMatchObject({ correct: 9, total: 10 });
    expect(first.json.results[0].explain).toBeTruthy();
    const second = await client.post('/api/learning/prelab', { answers: all });
    expect(second.json.summary).toMatchObject({ best: 10, latest: 10, attempts: 2 });
  });

  it('预习题目只考原理，不出现任何步骤的选项原文', async () => {
    const { PRELAB_QUESTIONS } = await import('@zhian/shared');
    const text = PRELAB_QUESTIONS.map((q) => `${q.stem}${q.options.join('')}`).join('');
    for (const step of STEPS) {
      for (const option of step.fields.flatMap((field) => field.options ?? []).filter((option) => option.length >= 6)) {
        expect(text.includes(option), `${step.id}「${option}」`).toBe(false);
      }
    }
  });

  it('教师评价：教师可评、学生不可评；成绩表与报告显示预习成绩与教师评价', async () => {
    const results = await api(h.base, teacherToken).get('/api/admin/results?className=机械2601');
    const row = results.json.results.find((item: { username: string }) => item.username === '2026010101');
    expect(row.prelabBest).toBe(10);
    expect((await put(teacherToken, `/api/admin/results/${row.sessionId}/review`, { grade: '满分' })).status).toBe(400);
    const student = await login('2026010101', 'MyNewSecret2026');
    expect((await put(student.json.token, `/api/admin/results/${row.sessionId}/review`, { grade: '优秀' })).status).toBe(403);
    expect((await put(teacherToken, `/api/admin/results/${row.sessionId}/review`, { grade: '良好', comment: '数据分级准确，应急顺序需加强。' })).json.ok).toBe(true);
    const again = await api(h.base, teacherToken).get('/api/admin/results?className=机械2601');
    expect(again.json.results.find((item: { sessionId: number }) => item.sessionId === row.sessionId)).toMatchObject({ teacherGrade: '良好' });
    const report = await api(h.base, student.json.token).post('/api/ai/report', { sessionId: row.sessionId });
    expect(report.json.contentMd).toContain('预习成绩：10/10');
    expect(report.json.contentMd).toContain('教师评价：良好；数据分级准确');
    expect(report.json.contentMd).toContain('跨学科学习经历');
    const archive = await api(h.base, student.json.token).get('/api/learning/archive');
    expect(archive.json.sessions[0].teacherReview.grade).toBe('良好');
  });

  it('AI 审计与公平性监测：仅管理员；样本足够且组间差距大时提示复核', async () => {
    expect((await api(h.base, teacherToken).get('/api/admin/ai-audit')).status).toBe(403);
    const insertUser = db.prepare("INSERT INTO users (username, password_hash, role, points, created_at, major) VALUES (?, '!', 'student', 0, ?, ?)");
    const insertSession = db.prepare("INSERT INTO sessions (user_id, started_at, finished_at, total_score) VALUES (?, ?, ?, ?)");
    const now = new Date().toISOString();
    for (let i = 0; i < 10; i++) {
      for (const [major, score] of [['合成专业甲', 90], ['合成专业乙', 70]] as const) {
        const id = Number(insertUser.run(`fair_${major}_${i}`, now, major).lastInsertRowid);
        insertSession.run(id, now, now, score);
      }
    }
    const audit = await api(h.base, adminToken).get('/api/admin/ai-audit');
    expect(audit.json.fairness).toMatchObject({ gap: 20, flagged: true });
    expect(audit.json.byScenario.some((row: { scenario: string }) => row.scenario === 'admin:connectivity_test')).toBe(true);
  });
});
