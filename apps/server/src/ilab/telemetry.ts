import { BANK_VERSION } from '@zhian/shared';
import { db, nowIso } from '../db.js';
import { STEP_EXPORT_META } from './stepMeta.js';

/**
 * 真实过程采集：时间一律由服务器在收到事件时记录（server_ms），不信任客户端时钟。
 * 事件只在打开/关闭设备面板、首次改动输入（限频）、页面隐藏/恢复时发送，不逐帧写库。
 */
export const EVENT_TYPES = ['open', 'interact', 'pause', 'resume', 'close', 'hint'] as const;
export type StepEventType = (typeof EVENT_TYPES)[number];

/**
 * 证据质量：
 * - observed_interaction：服务器观测到打开与实际输入改动 → 可计入“学生实际交互”
 * - observed_no_change：打开后未改动任何输入就提交 → 有起止时间，但不算实操证据
 * - auto_step：自动步骤（S24 报告）→ 不计入实操
 * - missing_start：提交前没有观测到打开事件 → 起止不完整，阻断正式回传
 * - legacy_missing：本功能上线前的历史记录，没有任何过程证据
 */
export type EvidenceQuality = 'observed_interaction' | 'observed_no_change' | 'auto_step' | 'missing_start' | 'legacy_missing';

export interface AttemptRow {
  id: number;
  session_id: number;
  step_id: string;
  attempt_no: number;
  request_id: string | null;
  observed_start_ms: number | null;
  observed_end_ms: number;
  active_ms: number | null;
  interaction_count: number;
  input_hash: string;
  raw_score: number;
  raw_max_score: number;
  evidence_quality: EvidenceQuality;
  result_json: string;
}

export function recordEvent(sessionId: number, stepId: string, type: StepEventType, serverMs = Date.now()): void {
  db.prepare('INSERT INTO step_events (session_id, step_id, type, server_ms) VALUES (?, ?, ?, ?)').run(sessionId, stepId, type, serverMs);
}

export function attemptsFor(sessionId: number, stepId?: string): AttemptRow[] {
  return (stepId
    ? db.prepare('SELECT * FROM step_attempts WHERE session_id = ? AND step_id = ? ORDER BY attempt_no').all(sessionId, stepId)
    : db.prepare('SELECT * FROM step_attempts WHERE session_id = ? ORDER BY step_id, attempt_no').all(sessionId)) as unknown as AttemptRow[];
}

export function attemptByRequest(sessionId: number, requestId: string): AttemptRow | undefined {
  return db.prepare('SELECT * FROM step_attempts WHERE session_id = ? AND request_id = ?').get(sessionId, requestId) as AttemptRow | undefined;
}

/** 本次提交对应的观测窗口：上一次提交之后的事件 */
export function observeWindow(sessionId: number, stepId: string, submitMs: number): { startMs: number | null; activeMs: number | null; interactions: number } {
  const previous = db
    .prepare('SELECT MAX(observed_end_ms) AS last FROM step_attempts WHERE session_id = ? AND step_id = ?')
    .get(sessionId, stepId) as { last: number | null };
  const after = previous.last ?? 0;
  const events = db
    .prepare('SELECT type, server_ms FROM step_events WHERE session_id = ? AND step_id = ? AND server_ms > ? AND server_ms <= ? ORDER BY server_ms, id')
    .all(sessionId, stepId, after, submitMs) as Array<{ type: StepEventType; server_ms: number }>;
  let startMs: number | null = null;
  let activeMs = 0;
  let segment: number | null = null;
  let interactions = 0;
  for (const event of events) {
    if (event.type === 'open' || event.type === 'resume') {
      if (event.type === 'open' && startMs === null) startMs = event.server_ms;
      if (segment === null) segment = event.server_ms;
    } else if (event.type === 'pause' || event.type === 'close') {
      if (segment !== null) activeMs += event.server_ms - segment;
      segment = null;
    } else if (event.type === 'interact') {
      interactions += 1;
      if (segment === null && startMs !== null) segment = event.server_ms;
    }
  }
  if (segment !== null) activeMs += submitMs - segment;
  return { startMs, activeMs: startMs === null ? null : activeMs, interactions };
}

export function evidenceFor(stepId: string, startMs: number | null, interactions: number): EvidenceQuality {
  if (startMs === null) return 'missing_start';
  if (!STEP_EXPORT_META[stepId]?.countsAsStudentInteraction) return 'auto_step';
  return interactions > 0 ? 'observed_interaction' : 'observed_no_change';
}

export function recordAttempt(args: {
  sessionId: number;
  stepId: string;
  requestId: string | null;
  submitMs: number;
  inputHash: string;
  rawScore: number;
  rawMaxScore: number;
  resultJson: string;
}): AttemptRow {
  const window = observeWindow(args.sessionId, args.stepId, args.submitMs);
  const count = db.prepare('SELECT COUNT(*) AS c FROM step_attempts WHERE session_id = ? AND step_id = ?').get(args.sessionId, args.stepId) as { c: number };
  const attemptNo = Number(count.c) + 1;
  const evidence = evidenceFor(args.stepId, window.startMs, window.interactions);
  db.prepare(`
    INSERT INTO step_attempts (session_id, step_id, attempt_no, request_id, observed_start_ms, observed_end_ms, active_ms, interaction_count, input_hash, raw_score, raw_max_score, evidence_quality, result_json, created_at, bank_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(args.sessionId, args.stepId, attemptNo, args.requestId, window.startMs, args.submitMs, window.activeMs, window.interactions, args.inputHash, args.rawScore, args.rawMaxScore, evidence, args.resultJson, nowIso(), BANK_VERSION);
  return attemptsFor(args.sessionId, args.stepId).find((row) => row.attempt_no === attemptNo)!;
}
