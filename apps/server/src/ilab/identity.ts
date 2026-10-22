import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { HttpIlabClient, type ApiOutcome, type IlabClient, type TokenGrant } from './client.js';
import { ilabConfig, type IlabMode } from './config.js';
import { MockIlabClient, mockIlab } from './mockClient.js';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from './signature.js';

/** 按环境取客户端；测试中可替换工厂 */
let factory: (environment: IlabMode) => IlabClient = (environment) => {
  const config = ilabConfig();
  if (environment === 'mock') return new MockIlabClient(mockIlab, config.maxAttachmentBytes);
  const endpoint = environment === 'test' ? config.test : config.production;
  return new HttpIlabClient(environment, endpoint.baseUrl, endpoint.appid, endpoint.secret);
};

export function clientFor(environment: IlabMode): IlabClient {
  return factory(environment);
}

export function setClientFactory(next: (environment: IlabMode) => IlabClient): void {
  factory = next;
}

export interface ContextRow {
  id: number;
  identity_id: number;
  environment: IlabMode;
  appid: string;
  un: string;
  original_token_enc: string;
  current_token_enc: string;
  create_time_ms: number | null;
  expires_time_ms: number | null;
  refresh_count: number;
  synthetic: number;
}

/**
 * 外部身份 → 本地用户。身份键为 provider/environment/appid/un；
 * 永远新建独立的 student 用户，绝不因 un 与本地账号（如 admin）同名而复用。
 */
export function bindIdentity(environment: IlabMode, appid: string, un: string, dis: string): { identityId: number; userId: number } {
  const existing = db
    .prepare('SELECT id, user_id FROM external_identities WHERE provider = ? AND environment = ? AND appid = ? AND un = ?')
    .get('ilab', environment, appid, un) as { id: number; user_id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE external_identities SET dis = ? WHERE id = ?').run(dis, existing.id);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(dis || un, existing.user_id);
    return { identityId: existing.id, userId: existing.user_id };
  }
  // 本地用户名用不可登录的内部键，不与本地账号冲突；密码哈希为不可验证占位
  const internalName = `ilab#${environment}#${appid}#${randomUUID()}`;
  const user = db
    .prepare('INSERT INTO users (username, password_hash, role, points, created_at, display_name, external) VALUES (?, ?, ?, 0, ?, ?, 1)')
    .run(internalName, '!external', 'student', nowIso(), dis || un);
  const userId = Number(user.lastInsertRowid);
  const identity = db
    .prepare('INSERT INTO external_identities (provider, environment, appid, un, dis, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('ilab', environment, appid, un, dis, userId, nowIso());
  return { identityId: Number(identity.lastInsertRowid), userId };
}

export function createContext(identityId: number, environment: IlabMode, appid: string, grant: TokenGrant): number {
  const key = ilabConfig().tokenEncryptionKey;
  const sealed = encryptSecret(grant.accessToken, key);
  const info = db.prepare(`
    INSERT INTO ilab_contexts (identity_id, environment, appid, un, original_token_enc, current_token_enc, create_time_ms, expires_time_ms, refresh_count, synthetic, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(identityId, environment, appid, grant.un, sealed, sealed, grant.createTimeMs, grant.expiresTimeMs, environment === 'mock' ? 1 : 0, nowIso());
  return Number(info.lastInsertRowid);
}

export function getContext(contextId: number): ContextRow | undefined {
  return db.prepare('SELECT * FROM ilab_contexts WHERE id = ?').get(contextId) as ContextRow | undefined;
}

/** 某用户最近的外部上下文（用于开始新的绑定会话） */
export function latestContextForUser(userId: number): ContextRow | undefined {
  return db.prepare(`
    SELECT c.* FROM ilab_contexts c JOIN external_identities i ON i.id = c.identity_id
    WHERE i.user_id = ? ORDER BY c.id DESC LIMIT 1
  `).get(userId) as ContextRow | undefined;
}

/** ticket 重放保护：只保存摘要，不保存原文 */
export function markTicketSeen(rawTicket: string): boolean {
  const digest = sha256Hex(rawTicket);
  const now = Date.now();
  db.prepare('DELETE FROM ilab_ticket_digests WHERE seen_ms < ?').run(now - 600_000);
  const existing = db.prepare('SELECT digest FROM ilab_ticket_digests WHERE digest = ?').get(digest);
  if (existing) return false;
  db.prepare('INSERT INTO ilab_ticket_digests (digest, seen_ms) VALUES (?, ?)').run(digest, now);
  return true;
}

/** 短时单次 handoff：浏览器只拿到随机码（HttpOnly cookie），库中只存摘要 */
export function createHandoff(contextId: number, userId: number): string {
  const code = randomToken(32);
  db.prepare('INSERT INTO ilab_handoffs (code_hash, context_id, user_id, expires_ms, used_at_ms) VALUES (?, ?, ?, ?, NULL)')
    .run(sha256Hex(code), contextId, userId, Date.now() + ilabConfig().handoffTtlSeconds * 1000);
  return code;
}

export function consumeHandoff(code: string): { contextId: number; userId: number } | null {
  const hash = sha256Hex(code);
  const row = db.prepare('SELECT context_id, user_id, expires_ms, used_at_ms FROM ilab_handoffs WHERE code_hash = ?').get(hash) as
    | { context_id: number; user_id: number; expires_ms: number; used_at_ms: number | null }
    | undefined;
  if (!row || row.used_at_ms !== null || row.expires_ms < Date.now()) return null;
  const update = db.prepare('UPDATE ilab_handoffs SET used_at_ms = ? WHERE code_hash = ? AND used_at_ms IS NULL').run(Date.now(), hash);
  if (Number(update.changes) !== 1) return null;
  return { contextId: row.context_id, userId: row.user_id };
}

/** 调用预算：每个上下文的外部调用（不含换票）有保守上限，防止触发 code=18 */
export function ledgerCount(contextId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM ilab_call_ledger WHERE context_id = ? AND endpoint <> 'token'").get(contextId) as { c: number };
  return Number(row.c);
}

export function recordCall(contextId: number, endpoint: string, outcome: ApiOutcome | { kind: string }): void {
  const summary = outcome.kind === 'business_error' ? `code:${(outcome as { code: number }).code}` : outcome.kind;
  db.prepare('INSERT INTO ilab_call_ledger (context_id, endpoint, outcome, at_ms) VALUES (?, ?, ?, ?)').run(contextId, endpoint, summary, Date.now());
}

export class BudgetExhaustedError extends Error {
  constructor() {
    super('本次实验空间调用预算已用尽；为避免触发令牌使用次数限制，已停止自动重试，请联系教师处理');
  }
}

export class ReentryRequiredError extends Error {
  constructor(reason: string) {
    super(`实验空间登录凭据不可用（${reason}），请从实验空间重新进入本实验`);
  }
}

const refreshing = new Map<number, Promise<string>>();

/**
 * 取当前可用的 ILAB access_token。临近过期时用“原始 token”刷新，最多 2 次；
 * 刷新得到的 token 不再作为原始 token 链式刷新。并发刷新单飞。
 */
export async function accessTokenFor(contextId: number, forceRefresh = false): Promise<string> {
  const context = getContext(contextId);
  if (!context) throw new ReentryRequiredError('上下文不存在');
  const key = ilabConfig().tokenEncryptionKey;
  const current = decryptSecret(context.current_token_enc, key);
  if (!current) throw new ReentryRequiredError('令牌无法解密（服务器密钥变更或已重启的模拟环境）');
  const expiring = context.expires_time_ms !== null && context.expires_time_ms - Date.now() < 60_000;
  if (!forceRefresh && !expiring) return current;

  const inflight = refreshing.get(contextId);
  if (inflight) return inflight;
  const task = (async () => {
    const fresh = getContext(contextId)!;
    if (fresh.refresh_count >= 2) throw new ReentryRequiredError('刷新次数已用尽');
    if (ledgerCount(contextId) >= ilabConfig().outboundCallBudget) throw new BudgetExhaustedError();
    const original = decryptSecret(fresh.original_token_enc, key);
    if (!original) throw new ReentryRequiredError('原始令牌无法解密');
    const result = await clientFor(fresh.environment).refreshToken(original);
    recordCall(contextId, 'refresh', 'grant' in result ? { kind: 'ok' } : result.error);
    if (!('grant' in result)) {
      const error = result.error;
      throw new ReentryRequiredError(`刷新失败：${error.kind === 'business_error' ? `code ${error.code}` : error.kind === 'unknown' ? error.reason : '未知'}`);
    }
    db.prepare('UPDATE ilab_contexts SET current_token_enc = ?, expires_time_ms = ?, refresh_count = refresh_count + 1 WHERE id = ?')
      .run(encryptSecret(result.grant.accessToken, key), result.grant.expiresTimeMs, contextId);
    return result.grant.accessToken;
  })().finally(() => refreshing.delete(contextId));
  refreshing.set(contextId, task);
  return task;
}

/** 带预算的外部调用；token 超时（code 2）时尝试一次刷新后重试，其余错误不循环重试 */
export async function callWithToken(contextId: number, endpoint: string, run: (token: string) => Promise<ApiOutcome>): Promise<ApiOutcome> {
  if (ledgerCount(contextId) >= ilabConfig().outboundCallBudget) throw new BudgetExhaustedError();
  let token = await accessTokenFor(contextId);
  let outcome = await run(token);
  recordCall(contextId, endpoint, outcome);
  if (outcome.kind === 'business_error' && outcome.code === 2) {
    token = await accessTokenFor(contextId, true);
    if (ledgerCount(contextId) >= ilabConfig().outboundCallBudget) throw new BudgetExhaustedError();
    outcome = await run(token);
    recordCall(contextId, endpoint, outcome);
  }
  return outcome;
}
