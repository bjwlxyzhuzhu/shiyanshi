import { BRAND, STEPS } from '@zhian/shared';
import { buildProfile } from '@zhian/scoring';
import { db, nowIso } from '../db.js';
import { buildAiData } from './aiAudit.js';
import type { ApiOutcome } from './client.js';
import { SYNTHETIC_EXPECT_TIME_SEC, ilabConfig, loadExpectTimes, type IlabMode } from './config.js';
import { BudgetExhaustedError, ReentryRequiredError, callWithToken, clientFor, getContext, ledgerCount, type ContextRow } from './identity.js';
import { mapSession, type MapperIssue, type MapperOutput } from './mapper.js';
import { ReportFontMissingError, buildPdf, resolveReportFont, type PdfLine } from './pdf.js';
import { sha256Hex } from './signature.js';
import { attemptsFor, type AttemptRow } from './telemetry.js';

export interface SessionRow {
  id: number;
  user_id: number;
  started_at: string;
  finished_at: string | null;
  total_score: number;
  current_step_id: string;
  source: 'local' | 'ilab' | 'synthetic';
  ilab_context_id: number | null;
  origin_id: string | null;
  started_ms: number | null;
  completed_ms: number | null;
  locked: number;
}

interface OutboxRow {
  id: number;
  session_id: number;
  context_id: number;
  environment: IlabMode;
  origin_id: string;
  status_value: number;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  state: 'sending' | 'accepted' | 'rejected' | 'result_unknown' | 'pending_retry';
  attachment_state: string;
  report_id: number | null;
  attempts: number;
  last_error_code: string | null;
  last_error_summary: string | null;
  synthetic: number;
  updated_at: string;
}

export function getSession(sessionId: number): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

function latestOutbox(sessionId: number): OutboxRow | undefined {
  return db.prepare('SELECT * FROM ilab_outbox WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as OutboxRow | undefined;
}

export function isSynthetic(session: SessionRow, context?: ContextRow): boolean {
  return session.source === 'synthetic' || context?.synthetic === 1 || context?.environment === 'mock';
}

/** 把会话数据装配成导出结果（不发送、不写库） */
export function buildExport(session: SessionRow, status: 1 | 2): MapperOutput & { context: ContextRow } {
  const context = getContext(session.ilab_context_id ?? -1);
  if (!context) throw new Error('会话未绑定实验空间身份');
  const config = ilabConfig();
  const rows = db
    .prepare('SELECT step_id, score, max_score, output_json FROM step_records WHERE session_id = ?')
    .all(session.id) as unknown as Array<{ step_id: string; score: number; max_score: number; output_json: string }>;
  const records = new Map(rows.map((row) => [row.step_id, {
    score: Number(row.score),
    maxScore: Number(row.max_score),
    feedback: String((JSON.parse(row.output_json) as { feedback?: string }).feedback ?? '')
  }]));
  const attempts = new Map<string, AttemptRow[]>();
  for (const attempt of attemptsFor(session.id)) {
    const list = attempts.get(attempt.step_id) ?? [];
    list.push(attempt);
    attempts.set(attempt.step_id, list);
  }
  const ai = status === 1 ? buildAiData(session.id) : null;
  const output = mapSession({
    status,
    environment: context.environment,
    synthetic: isSynthetic(session, context),
    username: context.un,
    appid: context.appid,
    originId: session.origin_id ?? '',
    title: BRAND.fullName,
    sessionStartMs: session.started_ms,
    nowMs: Date.now(),
    steps: STEPS,
    records,
    attempts,
    expectTimes: loadExpectTimes(config),
    syntheticExpectTimeSec: SYNTHETIC_EXPECT_TIME_SEC,
    scorePolicy: config.scorePolicy,
    timePolicy: config.timeExportPolicy,
    aiData: ai?.aiData,
    aiBlockers: ai?.blockers
  });
  // mock 环境：口径待确认项降级为提示，便于完整演示；测试/正式环境保持阻断
  if (context.environment === 'mock') {
    const pending = output.blockers.filter((issue) => issue.policyPending);
    output.blockers = output.blockers.filter((issue) => !issue.policyPending);
    output.warnings.push(...pending.map((issue) => ({ ...issue, message: `${issue.message}（模拟环境仅提示）` })));
  }
  return { ...output, context };
}

/** 发送闸门：环境不能混用，合成数据永远不能进入正式环境 */
export function sendGate(session: SessionRow, context: ContextRow): MapperIssue[] {
  const config = ilabConfig();
  const issues: MapperIssue[] = [];
  if (context.environment !== config.mode) issues.push({ code: 'environment_mismatch', message: `会话属于 ${context.environment} 环境，当前服务运行在 ${config.mode} 模式，不能混用` });
  if (isSynthetic(session, context) && context.environment !== 'mock') issues.push({ code: 'synthetic_blocked', message: '合成/模拟数据不能发送到官方测试或正式环境' });
  if (context.environment === 'production') {
    if (isSynthetic(session, context)) issues.push({ code: 'synthetic_blocked', message: '合成数据禁止进入正式环境' });
    if (!config.productionAuthorized) issues.push({ code: 'production_not_authorized', message: '学校尚未授权正式接入（ILAB_PRODUCTION_AUTHORIZED=false）' });
  }
  if (context.environment !== 'mock' && !config.networkEnabled) issues.push({ code: 'network_disabled', message: '外连开关未开启（ILAB_NETWORK_ENABLED=false）' });
  if (!resolveReportFont()) issues.push({ code: 'report_font_missing', message: '服务器缺少可嵌入的中文字体，报告 PDF 无法正常显示中文' });
  return issues;
}

function profileOf(sessionId: number) {
  const rows = db.prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ?').all(sessionId) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
  return buildProfile(rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) })));
}

const EVIDENCE_LABEL: Record<string, string> = {
  observed_interaction: '实际交互',
  observed_no_change: '未改动输入即提交',
  auto_step: '自动步骤',
  missing_start: '缺少开始记录',
  legacy_missing: '历史记录无过程证据',
  none: '无'
};

/** 生成真实 PDF 报告文件并保存；模板生成，不调用大模型 */
export async function generateReport(session: SessionRow, exported: MapperOutput & { context: ContextRow }): Promise<{ id: number; size: number; sha256: string }> {
  const user = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(session.user_id) as { display_name: string | null; username: string };
  const synthetic = isSynthetic(session, exported.context);
  const profile = profileOf(session.id);
  const ai = buildAiData(session.id);
  const lines: PdfLine[] = [
    { text: `${BRAND.name} · 实验报告`, size: 20 },
    { text: BRAND.fullName, size: 12, gap: 4 },
    ...(synthetic ? [{ text: '【模拟环境 · 合成数据】本报告仅用于本地功能验证，不是真实学生实验记录。', size: 11, gap: 6 }] : []),
    { text: `学生：${user.display_name ?? user.username}`, gap: 10 },
    { text: `实验记录编号：${session.origin_id ?? '-'}` },
    { text: `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}` },
    { text: `总分（原始分）：${exported.audit.rawTotal} / 100；导出整数总分：${exported.audit.exportTotal}（口径：${exported.audit.scorePolicy}${exported.audit.scorePolicyConfirmed ? '' : '，待确认'}）` },
    { text: `有实际交互证据的步骤：${exported.audit.interactionVerified} / ${exported.audit.interactionCandidates}` },
    { text: '能力画像', size: 14, gap: 12 },
    ...profile.map((item) => ({ text: `${item.label}：${item.score} / ${item.max}（${item.percent}%）` })),
    { text: '步骤记录', size: 14, gap: 12 },
    ...exported.audit.steps.map((step) => {
      const name = STEPS.find((item) => item.id === step.stepId)?.name ?? step.stepId;
      const seconds = step.wallStartMs !== null && step.wallEndMs !== null ? `${Math.floor(step.wallEndMs / 1000) - Math.floor(step.wallStartMs / 1000)} 秒` : '无观测';
      return { text: `${step.stepId} ${name}｜得分 ${step.rawScore}/${step.rawMaxScore}｜提交 ${step.attempts} 次｜用时 ${seconds}｜过程证据：${EVIDENCE_LABEL[step.evidence] ?? step.evidence}` };
    }),
    { text: '人工智能使用说明', size: 14, gap: 12 },
    { text: `安全助手模型调用：${String(ai.aiData.ai_call_count)} 次（${ai.audit.policy === 'unconfirmed' ? '计次口径待确认，按收到模型响应计' : ai.audit.policy}）；未配置模型时由规则引擎兜底，不计调用。` },
    { text: '本报告由系统模板生成，未调用大模型；温度、脱敏、投毒检测等为确定性仿真，不属于模型调用。' }
  ];
  const bytes = await buildPdf(`${BRAND.name}实验报告`, lines);
  const sha = sha256Hex(bytes);
  const info = db.prepare('INSERT INTO ilab_reports (session_id, filename, mime, bytes, sha256, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(session.id, `zhian_report_${session.origin_id ?? session.id}.pdf`, 'application/pdf', bytes, sha, bytes.length, nowIso());
  return { id: Number(info.lastInsertRowid), size: bytes.length, sha256: sha };
}

export function latestReport(sessionId: number): { id: number; filename: string; bytes: Uint8Array; size: number; created_at: string } | undefined {
  return db.prepare('SELECT id, filename, bytes, size, created_at FROM ilab_reports WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as
    { id: number; filename: string; bytes: Uint8Array; size: number; created_at: string } | undefined;
}

function updateOutbox(id: number, fields: Partial<Record<'state' | 'attachment_state' | 'last_error_code' | 'last_error_summary' | 'report_id', string | number | null>>, bumpAttempts = false): void {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE ilab_outbox SET ${keys.map((key) => `${key} = ?`).join(', ')}${bumpAttempts ? ', attempts = attempts + 1' : ''}, updated_at = ? WHERE id = ?`)
    .run(...(Object.values(fields) as Array<string | number | null>), nowIso(), id);
}

function summarize(outcome: ApiOutcome): { code: string; summary: string } {
  if (outcome.kind === 'business_error') return { code: String(outcome.code), summary: outcome.msg.slice(0, 200) };
  if (outcome.kind === 'unknown') return { code: outcome.reason, summary: outcome.detail.slice(0, 200) };
  return { code: '0', summary: 'ok' };
}

/** 递归查找返回体中属于本记录的条目（成功样例是 meta/data，不强求 code=0） */
export function findRecord(body: unknown, originId: string, username: string): boolean {
  if (Array.isArray(body)) return body.some((item) => findRecord(item, originId, username));
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.originId === originId && (record.username === undefined || record.username === username)) return true;
    return Object.values(record).some((value) => findRecord(value, originId, username));
  }
  return false;
}

export interface SyncResult {
  ok: boolean;
  state: string;
  attachmentState?: string;
  blockers?: MapperIssue[];
  warnings?: MapperIssue[];
  message: string;
}

async function uploadAttachment(outbox: OutboxRow, session: SessionRow): Promise<string> {
  const report = latestReport(session.id);
  if (!report || report.size === 0) {
    updateOutbox(outbox.id, { attachment_state: 'missing_report' });
    return 'missing_report';
  }
  if (report.size > ilabConfig().maxAttachmentBytes) {
    updateOutbox(outbox.id, { attachment_state: 'too_large' });
    return 'too_large';
  }
  const context = getContext(outbox.context_id)!;
  const client = clientFor(context.environment);
  const outcome = await callWithToken(context.id, 'attachment_upload', (token) => client.uploadAttachment(token, {
    originId: outbox.origin_id,
    filename: report.filename,
    title: '实验报告',
    remarks: ''
  }, Buffer.from(report.bytes)));
  const { code, summary } = summarize(outcome);
  const state = outcome.kind === 'ok' ? 'accepted'
    : outcome.kind === 'unknown' ? 'unknown'
    : outcome.code === 6 ? 'duplicate_reported'
    : 'rejected';
  updateOutbox(outbox.id, { attachment_state: state, report_id: report.id, last_error_code: outcome.kind === 'ok' ? null : `attachment:${code}`, last_error_summary: outcome.kind === 'ok' ? null : summary });
  return state;
}

/** 超时/已存在时按 originId + username + appid 查询对账，不新建 originId、不盲目重发 */
export async function reconcile(sessionId: number): Promise<SyncResult> {
  const session = getSession(sessionId)!;
  const outbox = latestOutbox(sessionId);
  if (!outbox) return { ok: false, state: 'none', message: '没有待对账的回传记录' };
  if (outbox.state === 'accepted') return { ok: true, state: 'accepted', attachmentState: outbox.attachment_state, message: '结果已被接受' };
  const context = getContext(outbox.context_id)!;
  const client = clientFor(context.environment);
  try {
    const outcome = await callWithToken(context.id, 'data_get', (token) => client.getResults(token, { originId: outbox.origin_id, username: context.un }));
    if (outcome.kind === 'ok' && findRecord(outcome.body, outbox.origin_id, context.un)) {
      updateOutbox(outbox.id, { state: 'accepted', last_error_code: null, last_error_summary: null });
      db.prepare('UPDATE sessions SET locked = 1, completed_ms = COALESCE(completed_ms, ?) WHERE id = ?').run(Date.now(), sessionId);
      const attachmentState = outbox.attachment_state === 'accepted' ? 'accepted' : await uploadAttachment({ ...outbox, state: 'accepted' }, session);
      return { ok: true, state: 'accepted', attachmentState, message: '对账确认平台已接受该记录' };
    }
    if (outcome.kind === 'ok') {
      updateOutbox(outbox.id, { state: 'pending_retry', last_error_code: 'not_found', last_error_summary: '查询未找到该 originId，可用同一 originId 与同一冻结数据重发' });
      return { ok: false, state: 'pending_retry', message: '平台未找到该记录，可用同一记录编号重新提交' };
    }
    const { code, summary } = summarize(outcome);
    updateOutbox(outbox.id, { last_error_code: `data_get:${code}`, last_error_summary: summary });
    return { ok: false, state: outbox.state, message: `对账查询失败：${summary || code}` };
  } catch (error) {
    return { ok: false, state: outbox.state, message: error instanceof Error ? error.message : '对账失败' };
  }
}

async function sendFrozen(outbox: OutboxRow, session: SessionRow): Promise<SyncResult> {
  const context = getContext(outbox.context_id)!;
  const client = clientFor(context.environment);
  updateOutbox(outbox.id, { state: 'sending' }, true);
  const payload = JSON.parse(outbox.payload_json) as object;
  const outcome = await callWithToken(context.id, 'data_upload', (token) => client.uploadResult(token, payload));
  const { code, summary } = summarize(outcome);
  if (outcome.kind === 'ok') {
    updateOutbox(outbox.id, { state: 'accepted', last_error_code: null, last_error_summary: null });
    db.prepare('UPDATE sessions SET locked = 1, completed_ms = ? WHERE id = ?').run(Date.now(), session.id);
    const attachmentState = await uploadAttachment({ ...outbox, state: 'accepted' }, session);
    const where = context.environment === 'mock' ? '本地模拟平台（合成数据，未发送到实验空间）' : context.environment === 'test' ? '官方测试环境' : '实验空间';
    return { ok: true, state: 'accepted', attachmentState, message: attachmentState === 'accepted' ? `实验结果与报告已提交到${where}` : `实验结果已被${where}接受；报告附件需要单独处理` };
  }
  if (outcome.kind === 'unknown' || (outcome.kind === 'business_error' && outcome.code === 15)) {
    updateOutbox(outbox.id, { state: 'result_unknown', last_error_code: code, last_error_summary: summary });
    // 结果是否已被接受不可知：先按 originId 查询对账，不换新编号
    const reconciled = await reconcile(session.id);
    return reconciled.ok ? reconciled : { ...reconciled, message: `提交结果未知（${summary || code}），${reconciled.message}` };
  }
  updateOutbox(outbox.id, { state: 'rejected', last_error_code: code, last_error_summary: summary });
  db.prepare('UPDATE sessions SET locked = 0 WHERE id = ?').run(session.id);
  return { ok: false, state: 'rejected', message: `平台拒绝（code ${code}）：${summary}` };
}

/**
 * 结束确认并回传：校验证据 → 生成报告文件 → 冻结 ai_data 与结果 → data_upload(status=1)
 * → 同 originId 上传附件。任何阻断项都不会被自动“补齐”。
 */
export async function finalizeSession(sessionId: number): Promise<SyncResult> {
  const session = getSession(sessionId);
  if (!session?.ilab_context_id) return { ok: false, state: 'unbound', message: '本会话不是从实验空间进入的，不能回传（本地练习不受影响）' };
  const previous = latestOutbox(sessionId);
  if (previous?.state === 'accepted') return { ok: false, state: 'accepted', attachmentState: previous.attachment_state, message: '该实验记录已被平台接受，不能再修改；如需重做请开始新的实验会话' };
  if (previous && (previous.state === 'result_unknown' || previous.state === 'sending')) return reconcile(sessionId);

  try {
    if (previous?.state === 'pending_retry') return await sendFrozen(previous, session);

    const exported = buildExport(session, 1);
    const gate = sendGate(session, exported.context);
    const blockers = [...gate, ...exported.blockers];
    if (blockers.length) return { ok: false, state: 'blocked', blockers, warnings: exported.warnings, message: '存在阻断项，未提交；本地进度已保留' };
    if (ledgerCount(exported.context.id) + 2 > ilabConfig().outboundCallBudget) throw new BudgetExhaustedError();

    const report = await generateReport(session, exported);
    const payloadJson = JSON.stringify(exported.payload);
    const version = Number((db.prepare('SELECT COUNT(*) AS c FROM ilab_outbox WHERE session_id = ?').get(sessionId) as { c: number }).c) + 1;
    db.prepare('UPDATE sessions SET locked = 1 WHERE id = ?').run(sessionId);
    const info = db.prepare(`
      INSERT INTO ilab_outbox (session_id, context_id, environment, appid, username, origin_id, status_value, payload_version, payload_json, payload_sha256, export_audit_json, state, attachment_state, report_id, synthetic, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'sending', 'pending', ?, ?, ?, ?)
    `).run(sessionId, exported.context.id, exported.context.environment, exported.context.appid, exported.context.un, session.origin_id!, version, payloadJson, sha256Hex(payloadJson), JSON.stringify({ audit: exported.audit, warnings: exported.warnings }), report.id, isSynthetic(session, exported.context) ? 1 : 0, nowIso(), nowIso());
    const outbox = db.prepare('SELECT * FROM ilab_outbox WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as OutboxRow;
    const result = await sendFrozen(outbox, session);
    return { ...result, warnings: exported.warnings };
  } catch (error) {
    if (error instanceof BudgetExhaustedError || error instanceof ReentryRequiredError || error instanceof ReportFontMissingError) return { ok: false, state: 'blocked', message: error.message };
    throw error;
  }
}

export async function retryAttachment(sessionId: number): Promise<SyncResult> {
  const session = getSession(sessionId)!;
  const outbox = latestOutbox(sessionId);
  if (!outbox || outbox.state !== 'accepted') return { ok: false, state: outbox?.state ?? 'none', message: '结果尚未被接受，不能单独上传附件' };
  if (outbox.attachment_state === 'accepted') return { ok: true, state: 'accepted', attachmentState: 'accepted', message: '报告附件已上传' };
  if (outbox.attachment_state === 'duplicate_reported') return { ok: false, state: 'accepted', attachmentState: 'duplicate_reported', message: '平台提示附件已存在，请人工核对，不自动重复上传' };
  try {
    const attachmentState = await uploadAttachment(outbox, session);
    return { ok: attachmentState === 'accepted', state: 'accepted', attachmentState, message: attachmentState === 'accepted' ? '报告附件已上传' : `附件状态：${attachmentState}` };
  } catch (error) {
    return { ok: false, state: 'accepted', attachmentState: outbox.attachment_state, message: error instanceof Error ? error.message : '附件上传失败' };
  }
}

/** 未完成阶段快照（status=2），默认关闭；同一 originId 覆盖，不逐步上传 */
export async function uploadSnapshot(sessionId: number): Promise<SyncResult> {
  if (!ilabConfig().incompleteUploadsEnabled) return { ok: false, state: 'disabled', message: '未完成阶段回传未启用（ILAB_INCOMPLETE_UPLOADS_ENABLED=false）' };
  const session = getSession(sessionId);
  if (!session?.ilab_context_id) return { ok: false, state: 'unbound', message: '会话未绑定实验空间' };
  if (latestOutbox(sessionId)?.state === 'accepted') return { ok: false, state: 'accepted', message: '完成记录已接受，不能再上传未完成快照' };
  const exported = buildExport(session, 2);
  const blockers = [...sendGate(session, exported.context), ...exported.blockers];
  if (blockers.length) return { ok: false, state: 'blocked', blockers, message: '存在阻断项' };
  const client = clientFor(exported.context.environment);
  try {
    const outcome = await callWithToken(exported.context.id, 'data_upload', (token) => client.uploadResult(token, exported.payload));
    return { ok: outcome.kind === 'ok', state: outcome.kind === 'ok' ? 'snapshot_saved' : 'snapshot_failed', message: outcome.kind === 'ok' ? '阶段快照已保存' : summarize(outcome).summary };
  } catch (error) {
    return { ok: false, state: 'blocked', message: error instanceof Error ? error.message : '快照失败' };
  }
}

/** 前端同步面板所需的状态（不含任何令牌或密钥） */
export function sessionSyncStatus(sessionId: number) {
  const session = getSession(sessionId)!;
  if (!session.ilab_context_id) return { bound: false as const };
  const outbox = latestOutbox(sessionId);
  const report = latestReport(sessionId);
  const exported = buildExport(session, 1);
  const gate = sendGate(session, exported.context);
  return {
    bound: true as const,
    environment: exported.context.environment,
    synthetic: isSynthetic(session, exported.context),
    originId: session.origin_id,
    locked: session.locked === 1,
    readiness: {
      blockers: [...gate, ...exported.blockers],
      warnings: exported.warnings,
      interactionVerified: exported.audit.interactionVerified,
      interactionCandidates: exported.audit.interactionCandidates,
      exportTotal: exported.audit.exportTotal,
      rawTotal: exported.audit.rawTotal,
      scorePolicy: exported.audit.scorePolicy,
      scorePolicyConfirmed: exported.audit.scorePolicyConfirmed
    },
    outbox: outbox ? { state: outbox.state, attachmentState: outbox.attachment_state, attempts: outbox.attempts, lastErrorCode: outbox.last_error_code, lastErrorSummary: outbox.last_error_summary, updatedAt: outbox.updated_at } : null,
    report: report ? { id: report.id, size: report.size, createdAt: report.created_at } : null,
    budget: { used: ledgerCount(exported.context.id), limit: ilabConfig().outboundCallBudget }
  };
}
