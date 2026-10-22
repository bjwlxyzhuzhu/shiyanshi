import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db.js';
import { HttpIlabClient, NetworkDisabledError } from '../src/ilab/client.js';
import { MOCK_APPID } from '../src/ilab/config.js';
import { ReentryRequiredError, accessTokenFor, bindIdentity, createContext } from '../src/ilab/identity.js';
import { mockIlab } from '../src/ilab/mockClient.js';
import { getSession, sendGate } from '../src/ilab/outbox.js';
import { blockedFetches } from './setup.js';
import { STEP_LIST, api, changedInput, configure, launch, startServer, type Harness } from './harness.js';

let h: Harness;
let clock = 1_790_000_000_000;
const tick = (ms: number) => {
  clock += ms;
  vi.setSystemTime(clock);
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  h = await startServer();
});
afterAll(async () => {
  await h.close();
  vi.useRealTimers();
});
beforeEach(() => {
  configure({ outboundCallBudget: 8 });
});

/** 完整走 24 步：每步打开设备 → 改动输入 → 提交，步间推进真实（模拟）时间 */
async function playAll(token: string, sessionId: number, options: { skipInteractionFor?: string[] } = {}) {
  const client = api(h.base, token);
  for (const step of STEP_LIST) {
    tick(2_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: step.id, type: 'open' }] });
    tick(8_000);
    const skip = options.skipInteractionFor?.includes(step.id) || step.fields.length === 0;
    if (!skip) await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: step.id, type: 'interact' }] });
    tick(20_000);
    const res = await client.post(`/api/experiment/${sessionId}/step/${step.id}`, { input: skip ? {} : changedInput(step), requestId: `req_${sessionId}_${step.id}_1` });
    expect(res.status).toBe(200);
  }
  tick(5_000);
}

describe('入口与身份', () => {
  it('合成 ticket 含 + / =，换票成功并 303 到不含 ticket 的地址', async () => {
    const result = await launch(h.base, 'stu_plus');
    expect(decodeURIComponent(result.launchUrl)).toMatch(/\+.*\/.*=/);
    expect(result.launchStatus).toBe(303);
    expect(result.location).not.toContain('ticket');
    expect(result.location).toContain('?ilab=1');
    expect(result.cookie).toMatch(/^zhian_ilab_handoff=/);
    expect(result.bootStatus).toBe(200);
    expect(result.ilab).toEqual({ environment: 'mock', synthetic: true });
    // 返回给浏览器的只有本校 token，不含 ILAB access_token
    const ilabTokens = [...mockIlab.tokens.keys()];
    expect(ilabTokens.some((value) => JSON.stringify(result).includes(value))).toBe(false);
  });

  it('handoff 只能使用一次；ticket 不能重放', async () => {
    const result = await launch(h.base, 'stu_once');
    const again = await fetch(`${h.base}/api/ilab/bootstrap`, { method: 'POST', headers: { cookie: result.cookie } });
    expect(again.status).toBe(401);
    const replay = await fetch(`${h.base}${result.launchUrl}`, { redirect: 'manual' });
    expect(replay.headers.get('location')).toContain('ilab_error=ticket_replayed');
  });

  it('缺少或无效 ticket 给出明确错误，不进入实验', async () => {
    const missing = await fetch(`${h.base}/ilab/launch`, { redirect: 'manual' });
    expect(missing.headers.get('location')).toContain('ilab_error=missing_ticket');
    const invalid = await fetch(`${h.base}/ilab/launch?ticket=FORGED%2Bticket`, { redirect: 'manual' });
    expect(invalid.headers.get('location')).toContain('ilab_error=ticket_invalid');
  });

  it('外部账号 un=admin 不会绑定本地管理员，默认学生权限', async () => {
    const result = await launch(h.base, 'admin');
    expect(result.user.role).toBe('student');
    const localAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    expect(result.user.id).not.toBe(localAdmin.id);
    const readiness = await api(h.base, result.token).get('/api/ilab/readiness');
    expect(readiness.status).toBe(403);
  });

  it('同一 un 在不同环境/appid 是不同身份；同环境再次进入复用同一身份', () => {
    const a = bindIdentity('mock', MOCK_APPID, 'same_un', 'A');
    const b = bindIdentity('test', '10000', 'same_un', 'A');
    const c = bindIdentity('mock', MOCK_APPID, 'same_un', 'A2');
    expect(a.userId).not.toBe(b.userId);
    expect(c.userId).toBe(a.userId);
  });
});

describe('真实过程采集', () => {
  it('提交记录追加式尝试；重复 requestId 幂等；重提才增加 repeatCount', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_attempts');
    const client = api(h.base, token);
    tick(1_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'open' }] });
    tick(5_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'interact' }] });
    tick(4_000);
    const first = await client.post(`/api/experiment/${sessionId}/step/S01`, { input: { role: '学生', materials: '安全培训合格证明' }, requestId: 'dup_request_0001' });
    const duplicate = await client.post(`/api/experiment/${sessionId}/step/S01`, { input: { role: '学生', materials: '安全培训合格证明' }, requestId: 'dup_request_0001' });
    expect(duplicate.json).toEqual(first.json);
    const rows = db.prepare('SELECT * FROM step_attempts WHERE session_id = ? AND step_id = ?').all(sessionId, 'S01') as Array<Record<string, number | string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.observed_end_ms as number - (rows[0]!.observed_start_ms as number)).toBe(9_000);
    expect(rows[0]!.evidence_quality).toBe('observed_interaction');

    tick(3_000);
    await client.post(`/api/experiment/${sessionId}/step/S01`, { input: { role: '学生', materials: '' }, requestId: 'dup_request_0002' });
    const after = db.prepare('SELECT attempt_no, evidence_quality, observed_start_ms FROM step_attempts WHERE session_id = ? AND step_id = ? ORDER BY attempt_no').all(sessionId, 'S01') as Array<{ attempt_no: number; evidence_quality: string; observed_start_ms: number | null }>;
    expect(after.map((row) => row.attempt_no)).toEqual([1, 2]);
    // 第二次没有新的打开事件：如实标记，不补造开始时间
    expect(after[1]!.observed_start_ms).toBeNull();
  });

  it('暂停期间不计入 active 时长，墙钟起止仍如实保存', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_pause');
    const client = api(h.base, token);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'open' }] });
    tick(10_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'pause' }] });
    tick(60_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'resume' }] });
    tick(5_000);
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'interact' }] });
    tick(5_000);
    await client.post(`/api/experiment/${sessionId}/step/S01`, { input: { role: '学生', materials: '实验任务书' }, requestId: 'pause_req_0001' });
    const row = db.prepare('SELECT observed_start_ms, observed_end_ms, active_ms FROM step_attempts WHERE session_id = ?').get(sessionId) as { observed_start_ms: number; observed_end_ms: number; active_ms: number };
    expect(row.observed_end_ms - row.observed_start_ms).toBe(80_000);
    expect(row.active_ms).toBe(20_000);
  });
});

describe('结束确认与回传（mock）', () => {
  it('完整 24 步：生成 PDF → 冻结 → 结果被接受 → 同 originId 上传原始字节附件 → 会话只读', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_full');
    const client = api(h.base, token);
    await playAll(token, sessionId);

    const status = await client.get(`/api/ilab/sessions/${sessionId}/status`);
    expect(status.json.readiness.blockers).toEqual([]);
    expect(status.json.readiness.interactionVerified).toBe(23);
    // 口径未确认：mock 中仅提示
    expect(status.json.readiness.warnings.map((w: { code: string }) => w.code)).toEqual(expect.arrayContaining(['score_policy_unconfirmed', 'ai_count_policy_unconfirmed']));

    const unconfirmed = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, {});
    expect(unconfirmed.status).toBe(400);

    const result = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json).toMatchObject({ ok: true, state: 'accepted', attachmentState: 'accepted' });

    const originId = getSession(sessionId)!.origin_id!;
    const record = mockIlab.records.get(originId)!;
    expect(record.status).toBe(1);
    expect(record.payload.ai_data).toEqual(expect.objectContaining({ ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] }));
    expect((record.payload.steps as unknown[]).length).toBe(24);
    expect(record.attachment!.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(record.attachment!.bytes.length).toBeLessThanOrEqual(5_000_000);

    // 报告可下载，是真实 PDF，且不含 ILAB 令牌
    const pdfRes = await fetch(`${h.base}/api/ilab/sessions/${sessionId}/report.pdf`, { headers: { Authorization: `Bearer ${token}` } });
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // 中文字体以子集形式嵌入（不依赖阅读器自带字体）
    expect(pdfBytes.includes(Buffer.from('/FontFile2')) || pdfBytes.includes(Buffer.from('/FontFile3'))).toBe(true);
    expect(Buffer.compare(pdfBytes, record.attachment!.bytes)).toBe(0);
    const pdf = { text: pdfBytes.toString('latin1') };
    for (const value of mockIlab.tokens.keys()) {
      expect(pdf.text.includes(value)).toBe(false);
      expect(JSON.stringify(status.json).includes(value)).toBe(false);
    }
    const outboxPayload = (db.prepare('SELECT payload_json FROM ilab_outbox WHERE session_id = ?').get(sessionId) as { payload_json: string }).payload_json;
    for (const value of mockIlab.tokens.keys()) expect(outboxPayload.includes(value)).toBe(false);

    // status=1 后只读
    const resubmit = await client.post(`/api/experiment/${sessionId}/step/S24`, { input: {} });
    expect(resubmit.status).toBe(409);
    const events = await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'open' }] });
    expect(events.status).toBe(409);
    const again = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(again.json.ok).toBe(false);
    expect(mockIlab.records.get(originId)!.versions).toBe(1);

    // 重做：新会话、新 originId，旧记录不变
    const reset = await client.post(`/api/experiment/${sessionId}/reset`);
    expect(reset.json.sessionId).not.toBe(sessionId);
    expect(getSession(reset.json.sessionId)!.origin_id).not.toBe(originId);
    expect(db.prepare('SELECT COUNT(*) AS c FROM step_records WHERE session_id = ?').get(sessionId)).toEqual({ c: 24 });
  });

  it('交互证据不足 20 步时阻断完成回传', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_lazy');
    await playAll(token, sessionId, { skipInteractionFor: ['S01', 'S02', 'S03', 'S04', 'S05'] });
    const result = await api(h.base, token).post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json.state).toBe('blocked');
    expect(result.json.blockers.map((b: { code: string }) => b.code)).toContain('interaction_below_20');
    expect(mockIlab.records.has(getSession(sessionId)!.origin_id!)).toBe(false);
  });

  it('结果 POST 超时（已写入、响应丢失）：先查询对账确认接受，不换 originId、不重复写入', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_timeout');
    await playAll(token, sessionId);
    mockIlab.failNext('data_upload', { type: 'timeout_after_apply' });
    const result = await api(h.base, token).post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json).toMatchObject({ ok: true, state: 'accepted' });
    const originId = getSession(sessionId)!.origin_id!;
    expect(mockIlab.records.get(originId)!.versions).toBe(1);
    expect(mockIlab.calls.filter((c) => c.endpoint === 'data_get').length).toBeGreaterThan(0);
  });

  it('结果 POST 超时（未写入）：对账未找到 → 用同一 originId 与同一冻结数据重发', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_lost');
    await playAll(token, sessionId);
    mockIlab.failNext('data_upload', { type: 'timeout_before_apply' });
    const client = api(h.base, token);
    const first = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(first.json.state).toBe('pending_retry');
    const originId = getSession(sessionId)!.origin_id!;
    const retry = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(retry.json.state).toBe('accepted');
    expect(mockIlab.records.has(originId)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS c FROM ilab_outbox WHERE session_id = ?').get(sessionId)).toEqual({ c: 1 });
  });

  it('结果成功但附件失败：只重试附件，不复制实验记录', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_attach');
    await playAll(token, sessionId);
    mockIlab.failNext('attachment_upload', { type: 'code', code: 8, msg: '附件为空或过大' });
    const client = api(h.base, token);
    const result = await client.post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json).toMatchObject({ ok: true, state: 'accepted', attachmentState: 'rejected' });
    const retry = await client.post(`/api/ilab/sessions/${sessionId}/attachment/retry`);
    expect(retry.json.attachmentState).toBe('accepted');
    expect(mockIlab.records.get(getSession(sessionId)!.origin_id!)!.versions).toBe(1);
  });

  it('平台业务拒绝（HTTP 正常但 code≠0）按失败处理并解除锁定', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_reject');
    await playAll(token, sessionId);
    mockIlab.failNext('data_upload', { type: 'code', code: 19, msg: 'ai_data.ai_models_used 错误' });
    const result = await api(h.base, token).post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json.state).toBe('rejected');
    expect(result.json.message).toContain('19');
    expect(getSession(sessionId)!.locked).toBe(0);
  });

  it('服务器缺少可嵌入中文字体时阻断提交，不生成中文空白的 PDF', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_nofont');
    await playAll(token, sessionId);
    process.env.ILAB_REPORT_FONT_PATH = 'Z:/no/such/font.ttf';
    try {
      const result = await api(h.base, token).post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
      expect(result.json.state).toBe('blocked');
      expect(result.json.blockers.map((b: { code: string }) => b.code)).toContain('report_font_missing');
    } finally {
      delete process.env.ILAB_REPORT_FONT_PATH;
    }
  });

  it('调用预算不足时停止，不循环重试', async () => {
    const { token, sessionId } = await launch(h.base, 'stu_budget');
    await playAll(token, sessionId);
    configure({ outboundCallBudget: 1 });
    const result = await api(h.base, token).post(`/api/ilab/sessions/${sessionId}/finalize`, { confirm: true });
    expect(result.json.state).toBe('blocked');
    expect(result.json.message).toContain('预算');
  });

  it('本地账号的普通练习不能回传', async () => {
    const res = await api(h.base, 'no-token').post('/api/ilab/sessions/1/finalize', { confirm: true });
    expect(res.status).toBe(401);
  });
});

describe('令牌刷新与网络/数据闸门', () => {
  it('只用原始 token 刷新、最多 2 次；并发刷新单飞', async () => {
    const ticket = mockIlab.issueTicket('stu_refresh', 'R');
    const { MockIlabClient } = await import('../src/ilab/mockClient.js');
    const exchange = await new MockIlabClient().exchangeTicket(ticket);
    if (!('grant' in exchange)) throw new Error('exchange failed');
    const { identityId } = bindIdentity('mock', MOCK_APPID, 'stu_refresh', 'R');
    const contextId = createContext(identityId, 'mock', MOCK_APPID, exchange.grant);
    const before = mockIlab.calls.filter((c) => c.endpoint === 'refresh').length;
    const [a, b] = await Promise.all([accessTokenFor(contextId, true), accessTokenFor(contextId, true)]);
    expect(a).toBe(b);
    expect(mockIlab.calls.filter((c) => c.endpoint === 'refresh').length - before).toBe(1);
    await accessTokenFor(contextId, true);
    await expect(accessTokenFor(contextId, true)).rejects.toBeInstanceOf(ReentryRequiredError);
  });

  it('网络开关关闭时真实客户端拒绝外连；开启后在测试中也被拦截', async () => {
    configure({ mode: 'test', networkEnabled: false });
    const client = new HttpIlabClient('test', 'http://39.105.173.29', '10000', 'not-a-real-secret');
    await expect(client.exchangeTicket('t')).rejects.toBeInstanceOf(NetworkDisabledError);
    configure({ mode: 'test', networkEnabled: true });
    const outcome = await client.exchangeTicket('t');
    expect('error' in outcome ? outcome.error?.kind : 'granted').toBe('unknown');
    expect(blockedFetches.some((url) => url.includes('39.105.173.29'))).toBe(true);
  });

  it('合成会话永远不能送往测试/正式环境；环境不得混用', () => {
    configure({ mode: 'production', networkEnabled: true, productionAuthorized: true });
    const session = { source: 'synthetic' } as Parameters<typeof sendGate>[0];
    const codes = sendGate(session, { environment: 'production', synthetic: 0 } as Parameters<typeof sendGate>[1]).map((issue) => issue.code);
    expect(codes).toContain('synthetic_blocked');
    const mixed = sendGate({ source: 'ilab' } as Parameters<typeof sendGate>[0], { environment: 'mock', synthetic: 1 } as Parameters<typeof sendGate>[1]).map((issue) => issue.code);
    expect(mixed).toContain('environment_mismatch');
  });
});
