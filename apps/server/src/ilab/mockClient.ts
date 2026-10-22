import { randomBytes } from 'node:crypto';
import type { ApiOutcome, IlabClient, ResultQuery, TokenGrant } from './client.js';
import { MOCK_APPID, MOCK_SECRET } from './config.js';
import { ticketSignature } from './signature.js';
import { validateAiData, validateResultPayload } from './validate.js';

/**
 * 本地模拟的实验空间：无任何网络访问，所有数据为合成数据。
 * 规则尽量贴近官方文档（签名、令牌次数、刷新上限、status=1 不可修改、附件约束），
 * 但“本地 mock 通过”不代表官方平台会接受。
 */
type Endpoint = 'token' | 'refresh' | 'data_upload' | 'attachment_upload' | 'data_get';
export type MockFault =
  | { type: 'timeout_after_apply' }
  | { type: 'timeout_before_apply' }
  | { type: 'code'; code: number; msg?: string };

interface MockToken {
  un: string;
  dis: string;
  original: boolean;
  originalOf?: string;
  refreshCount: number;
  uses: number;
  expiresMs: number;
}

interface MockRecord {
  username: string;
  appid: string;
  payload: Record<string, unknown>;
  status: number;
  attachment?: { filename: string; bytes: Buffer };
  versions: number;
}

export class MockIlabPlatform {
  readonly tickets = new Map<string, { un: string; dis: string; expiresMs: number; used: boolean }>();
  readonly tokens = new Map<string, MockToken>();
  readonly records = new Map<string, MockRecord>();
  readonly calls: Array<{ endpoint: Endpoint; at: number }> = [];
  private faults: Array<{ endpoint: Endpoint; fault: MockFault }> = [];
  now: () => number = () => Date.now();

  /** 生成合成 ticket：刻意包含 '+'、'/'、'=' 以覆盖编码处理 */
  issueTicket(un: string, dis: string): string {
    const ticket = `MOCK+${randomBytes(9).toString('base64')}/T=`;
    this.tickets.set(ticket, { un, dis, expiresMs: this.now() + 120_000, used: false });
    return ticket;
  }

  failNext(endpoint: Endpoint, fault: MockFault): void {
    this.faults.push({ endpoint, fault });
  }

  reset(): void {
    this.tickets.clear();
    this.tokens.clear();
    this.records.clear();
    this.calls.length = 0;
    this.faults = [];
  }

  private takeFault(endpoint: Endpoint): MockFault | null {
    const index = this.faults.findIndex((item) => item.endpoint === endpoint);
    if (index < 0) return null;
    return this.faults.splice(index, 1)[0]!.fault;
  }

  private issueToken(un: string, dis: string, original: boolean, originalOf?: string): TokenGrant {
    const accessToken = `mocktok_${randomBytes(18).toString('base64')}`;
    const created = this.now();
    const expiresMs = created + 24 * 3600_000;
    this.tokens.set(accessToken, { un, dis, original, originalOf, refreshCount: 0, uses: 0, expiresMs });
    return { accessToken, createTimeMs: created, expiresTimeMs: expiresMs, un, dis };
  }

  /** 令牌校验并计数；超过 10 次返回 18 */
  private useToken(token: string): MockToken | ApiOutcome {
    const record = this.tokens.get(token);
    if (!record) return { kind: 'business_error', code: 5, msg: '非法 token', body: null };
    if (record.expiresMs < this.now()) return { kind: 'business_error', code: 2, msg: 'token 超时', body: null };
    record.uses += 1;
    if (record.uses > 10) return { kind: 'business_error', code: 18, msg: 'token 使用超过 10 次', body: null };
    return record;
  }

  exchange(rawTicket: string, appid: string, signature: string): { grant: TokenGrant } | { error: ApiOutcome } {
    this.calls.push({ endpoint: 'token', at: this.now() });
    if (!rawTicket || !appid || !signature) return { error: { kind: 'business_error', code: 1, msg: '参数错误', body: null } };
    if (signature !== ticketSignature(rawTicket, appid, MOCK_SECRET) || appid !== MOCK_APPID) return { error: { kind: 'business_error', code: 2, msg: '签名错误', body: null } };
    const ticket = this.tickets.get(rawTicket);
    if (!ticket || ticket.used) return { error: { kind: 'business_error', code: 4, msg: '无效 ticket', body: null } };
    if (ticket.expiresMs < this.now()) return { error: { kind: 'business_error', code: 3, msg: 'ticket 过期', body: null } };
    ticket.used = true;
    return { grant: this.issueToken(ticket.un, ticket.dis, true) };
  }

  refresh(originalToken: string): { grant: TokenGrant } | { error: ApiOutcome } {
    this.calls.push({ endpoint: 'refresh', at: this.now() });
    const fault = this.takeFault('refresh');
    if (fault?.type === 'code') return { error: { kind: 'business_error', code: fault.code, msg: fault.msg ?? '', body: null } };
    const record = this.tokens.get(originalToken);
    if (!record || !record.original) return { error: { kind: 'business_error', code: 5, msg: '只能用原始 token 刷新', body: null } };
    if (record.refreshCount >= 2) return { error: { kind: 'business_error', code: 5, msg: '刷新次数已用尽', body: null } };
    record.refreshCount += 1;
    return { grant: this.issueToken(record.un, record.dis, false, originalToken) };
  }

  upload(token: string, payload: Record<string, unknown>): ApiOutcome {
    this.calls.push({ endpoint: 'data_upload', at: this.now() });
    const fault = this.takeFault('data_upload');
    if (fault?.type === 'timeout_before_apply') return { kind: 'unknown', reason: 'timeout', detail: 'mock 超时（未写入）' };
    if (fault?.type === 'code') return { kind: 'business_error', code: fault.code, msg: fault.msg ?? '', body: null };
    const used = this.useToken(token);
    if ('kind' in used) return used;
    if (payload.username !== used.un) return { kind: 'business_error', code: 4, msg: 'username 不一致', body: null };
    if (payload.appid !== MOCK_APPID) return { kind: 'business_error', code: 3, msg: 'appid 授权不一致', body: null };
    const issues = validateResultPayload(payload, this.now());
    if (issues.length) {
      const aiIssue = payload.ai_data !== undefined && validateAiData(payload.ai_data).length > 0;
      const tooFew = issues.some((issue) => issue.path === 'steps' && issue.message.includes('10'));
      const code = aiIssue ? 19 : tooFew ? 14 : issues.some((issue) => issue.path.startsWith('steps')) ? 11 : issues.some((issue) => issue.path === 'score') ? 9 : 6;
      return { kind: 'business_error', code, msg: issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ').slice(0, 300), body: null };
    }
    const originId = String(payload.originId);
    const existing = this.records.get(originId);
    if (existing && (existing.status === 1 || existing.username !== used.un)) return { kind: 'business_error', code: 15, msg: 'originId 已存在', body: null };
    this.records.set(originId, { username: used.un, appid: MOCK_APPID, payload, status: Number(payload.status), versions: (existing?.versions ?? 0) + 1, attachment: existing?.attachment });
    if (fault?.type === 'timeout_after_apply') return { kind: 'unknown', reason: 'timeout', detail: 'mock 超时（已写入，响应丢失）' };
    return { kind: 'ok', body: { code: 0, msg: 'success' } };
  }

  attach(token: string, params: { appid: string; originId: string; filename: string }, bytes: Buffer, maxBytes: number): ApiOutcome {
    this.calls.push({ endpoint: 'attachment_upload', at: this.now() });
    const fault = this.takeFault('attachment_upload');
    if (fault?.type === 'timeout_before_apply') return { kind: 'unknown', reason: 'timeout', detail: 'mock 附件超时（未写入）' };
    if (fault?.type === 'code') return { kind: 'business_error', code: fault.code, msg: fault.msg ?? '', body: null };
    const used = this.useToken(token);
    if ('kind' in used) return used;
    const record = this.records.get(params.originId);
    if (!record || record.username !== used.un) return { kind: 'business_error', code: 7, msg: 'originId 对应结果不存在', body: null };
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) return { kind: 'business_error', code: 8, msg: '附件为空或过大', body: null };
    if (record.attachment) return { kind: 'business_error', code: 6, msg: '附件重复', body: null };
    record.attachment = { filename: params.filename, bytes };
    if (fault?.type === 'timeout_after_apply') return { kind: 'unknown', reason: 'timeout', detail: 'mock 附件超时（已写入，响应丢失）' };
    return { kind: 'ok', body: { code: 0, msg: 'success' } };
  }

  get(token: string, query: ResultQuery): ApiOutcome {
    this.calls.push({ endpoint: 'data_get', at: this.now() });
    const used = this.useToken(token);
    if ('kind' in used) return used;
    const data = [...this.records.entries()]
      .filter(([originId, record]) => record.username === used.un && (!query.originId || originId === query.originId) && (!query.username || query.username === record.username))
      .map(([originId, record]) => ({ originId, username: record.username, status: record.status, score: record.payload.score, hasAttachment: Boolean(record.attachment) }));
    // 与官方成功样例一致：meta/data 结构，没有 code 字段
    return { kind: 'ok', body: { meta: { total: data.length }, data } };
  }
}

export const mockIlab = new MockIlabPlatform();

export class MockIlabClient implements IlabClient {
  readonly environment = 'mock' as const;
  readonly appid = MOCK_APPID;
  constructor(private readonly platform: MockIlabPlatform = mockIlab, private readonly maxAttachmentBytes = 5_000_000) {}

  async exchangeTicket(rawTicket: string) {
    return this.platform.exchange(rawTicket, this.appid, ticketSignature(rawTicket, this.appid, MOCK_SECRET));
  }

  async refreshToken(originalToken: string) {
    return this.platform.refresh(originalToken);
  }

  async uploadResult(accessToken: string, payload: object) {
    // 走一遍真实序列化，确保发送的是 JSON 对象而不是二次包装的字符串
    return this.platform.upload(accessToken, JSON.parse(JSON.stringify(payload)) as Record<string, unknown>);
  }

  async uploadAttachment(accessToken: string, params: { originId: string; filename: string; title: string; remarks: string }, bytes: Buffer) {
    return this.platform.attach(accessToken, { appid: this.appid, originId: params.originId, filename: params.filename }, bytes, this.maxAttachmentBytes);
  }

  async getResults(accessToken: string, query: ResultQuery) {
    return this.platform.get(accessToken, query);
  }
}
