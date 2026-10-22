import { ilabConfig, type IlabMode } from './config.js';
import { buildQuery, redactUrl, ticketSignature, tokenSignature } from './signature.js';

/** 换票/刷新结果；token 只在服务端内存与加密存储中流转 */
export interface TokenGrant {
  accessToken: string;
  createTimeMs: number | null;
  expiresTimeMs: number | null;
  un: string;
  dis: string;
}

/**
 * 一次外部调用的结果。业务 code 非 0 视为失败（HTTP 200 不等于成功）；
 * 超时/网络错误为 unknown——结果是否已被平台接受不可知，必须先查询对账。
 */
export type ApiOutcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'business_error'; code: number; msg: string; body: unknown }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'bad_response'; detail: string };

export interface ResultQuery {
  originId?: string;
  username?: string;
  start?: number;
}

export interface IlabClient {
  readonly environment: IlabMode;
  readonly appid: string;
  exchangeTicket(rawTicket: string): Promise<{ grant: TokenGrant } | { error: ApiOutcome }>;
  refreshToken(originalToken: string): Promise<{ grant: TokenGrant } | { error: ApiOutcome }>;
  uploadResult(accessToken: string, payload: object): Promise<ApiOutcome>;
  uploadAttachment(accessToken: string, params: { originId: string; filename: string; title: string; remarks: string }, bytes: Buffer): Promise<ApiOutcome>;
  getResults(accessToken: string, query: ResultQuery): Promise<ApiOutcome>;
}

export class NetworkDisabledError extends Error {
  constructor(environment: string) {
    super(`ILAB ${environment} 外连未开启（ILAB_NETWORK_ENABLED=false 或 ILAB_MODE 不一致）`);
  }
}

/** 时间字段可能是秒、毫秒或日期字符串；无法可靠解析时返回 null，不硬算 24 小时 */
export function parseTimeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value.replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function grantFromBody(body: Record<string, unknown>): TokenGrant | null {
  if (typeof body.access_token !== 'string' || !body.access_token) return null;
  return {
    accessToken: body.access_token,
    createTimeMs: parseTimeMs(body.create_time),
    expiresTimeMs: parseTimeMs(body.expires_time),
    un: typeof body.un === 'string' ? body.un : '',
    dis: typeof body.dis === 'string' ? body.dis : ''
  };
}

export function interpret(body: unknown): ApiOutcome {
  if (typeof body !== 'object' || body === null) return { kind: 'unknown', reason: 'bad_response', detail: '响应不是 JSON 对象' };
  const record = body as Record<string, unknown>;
  // 查询接口的成功样例是 meta/data 结构，不强求 code=0
  if (record.code === undefined && ('meta' in record || 'data' in record)) return { kind: 'ok', body };
  const code = Number(record.code);
  if (code === 0) return { kind: 'ok', body };
  if (Number.isFinite(code)) return { kind: 'business_error', code, msg: String(record.msg ?? ''), body };
  return { kind: 'unknown', reason: 'bad_response', detail: '缺少业务 code' };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 官方测试/正式环境客户端。只有 mode 与环境一致且 networkEnabled=true 时才允许外连。 */
export class HttpIlabClient implements IlabClient {
  constructor(
    readonly environment: Exclude<IlabMode, 'mock'>,
    private readonly baseUrl: string,
    readonly appid: string,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  private guard(): void {
    const config = ilabConfig();
    if (!config.networkEnabled || config.mode !== this.environment) throw new NetworkDisabledError(this.environment);
    if (!this.secret) throw new Error(`ILAB ${this.environment} SECRET 未在服务器私有配置中设置`);
  }

  private async call(path: string, query: Record<string, string | number | undefined>, init: RequestInit = {}): Promise<ApiOutcome> {
    this.guard();
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}?${buildQuery(query)}`;
    try {
      const response = await this.fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status >= 300 && response.status < 400) {
        return { kind: 'unknown', reason: 'bad_response', detail: `HTTP ${response.status} 重定向（检查是否缺少 www 或协议）` };
      }
      const text = await response.text();
      try {
        return interpret(JSON.parse(text));
      } catch {
        return { kind: 'unknown', reason: 'bad_response', detail: `HTTP ${response.status} 非 JSON 响应` };
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const detail = `${redactUrl(path)} ${error instanceof Error ? error.message : String(error)}`;
      return { kind: 'unknown', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', detail };
    }
  }

  async exchangeTicket(rawTicket: string) {
    const outcome = await this.call('/open/api/v2/token', { ticket: rawTicket, appid: this.appid, signature: ticketSignature(rawTicket, this.appid, this.secret) });
    if (outcome.kind !== 'ok') return { error: outcome };
    const grant = grantFromBody(outcome.body as Record<string, unknown>);
    return grant ? { grant } : { error: { kind: 'unknown', reason: 'bad_response', detail: '缺少 access_token' } as ApiOutcome };
  }

  async refreshToken(originalToken: string) {
    const outcome = await this.call('/open/api/v2/token/refresh', { access_token: originalToken, appid: this.appid, signature: tokenSignature(originalToken, this.appid, this.secret) });
    if (outcome.kind !== 'ok') return { error: outcome };
    const grant = grantFromBody(outcome.body as Record<string, unknown>);
    return grant ? { grant } : { error: { kind: 'unknown', reason: 'bad_response', detail: '缺少 access_token' } as ApiOutcome };
  }

  uploadResult(accessToken: string, payload: object) {
    return this.call('/open/api/v2/data_upload', { access_token: accessToken }, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }

  uploadAttachment(accessToken: string, params: { originId: string; filename: string; title: string; remarks: string }, bytes: Buffer) {
    // 请求体直接是文件原始字节：不是 multipart、不是 JSON、不是文件 URL
    return this.call('/open/api/v2/attachment_upload', { access_token: accessToken, appid: this.appid, ...params }, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes)
    });
  }

  getResults(accessToken: string, query: ResultQuery) {
    return this.call('/open/api/v2/data_get', {
      access_token: accessToken,
      appid: this.appid,
      signature: tokenSignature(accessToken, this.appid, this.secret),
      start: query.start,
      username: query.username,
      originId: query.originId
    });
  }
}
