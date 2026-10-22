import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveReportFont } from './pdf.js';

/**
 * 实验空间（ILAB）对接配置。只在服务端读取，不得以 VITE_* 暴露给前端。
 * 默认 mock + 网络关闭：没有任何正式密钥时也能完整运行本地流程。
 */
export type IlabMode = 'mock' | 'test' | 'production';
export type ScorePolicy = 'unconfirmed' | 'preserve_weights_round' | 'normalize_step_percent';
export type AiCountPolicy = 'unconfirmed' | 'response_received' | 'dispatched';
export type TimeExportPolicy = 'unconfirmed' | 'floor_seconds';

export interface EnvEndpoint {
  baseUrl: string;
  appid: string;
  /** 只在内存中使用，不写日志、不进 payload、不返回前端 */
  secret: string;
}

export interface IlabConfig {
  mode: IlabMode;
  networkEnabled: boolean;
  test: EnvEndpoint;
  production: EnvEndpoint;
  publicOrigin: string;
  postLaunchPath: string;
  tokenEncryptionKey: string;
  handoffTtlSeconds: number;
  expectTimeConfigPath: string;
  scorePolicy: ScorePolicy;
  aiCountPolicy: AiCountPolicy;
  timeExportPolicy: TimeExportPolicy;
  incompleteUploadsEnabled: boolean;
  outboundCallBudget: number;
  maxAttachmentBytes: number;
  productionAuthorized: boolean;
  aiModel: { model: string; version: string; deployment: string; provider: string };
}

/** mock 专用常量：明确是合成值，不是任何真实凭据 */
export const MOCK_APPID = 'MOCK_APPID_SYNTHETIC';
export const MOCK_SECRET = 'MOCK_SECRET_NOT_A_REAL_CREDENTIAL';
export const MOCK_BASE_URL = 'mock://ilab';

export const OFFICIAL = {
  testBaseUrl: 'http://39.105.173.29',
  testPublicAppid: '10000',
  productionBaseUrl: 'https://www.ilab-x.com'
};

export const DEPLOYMENTS = ['公有云服务', '私有化部署', '混合服务', '本地运行'] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadIlabConfig(env: NodeJS.ProcessEnv = process.env): IlabConfig {
  return {
    mode: pick(env.ILAB_MODE, ['mock', 'test', 'production'] as const, 'mock'),
    networkEnabled: bool(env.ILAB_NETWORK_ENABLED),
    test: {
      baseUrl: env.ILAB_TEST_BASE_URL || OFFICIAL.testBaseUrl,
      appid: env.ILAB_TEST_APPID || OFFICIAL.testPublicAppid,
      secret: env.ILAB_TEST_SECRET ?? ''
    },
    production: {
      baseUrl: env.ILAB_PRODUCTION_BASE_URL || OFFICIAL.productionBaseUrl,
      appid: env.ILAB_PRODUCTION_APPID ?? '',
      secret: env.ILAB_PRODUCTION_SECRET ?? ''
    },
    publicOrigin: (env.ILAB_PUBLIC_ORIGIN || 'http://localhost:5174').replace(/\/$/, ''),
    postLaunchPath: env.ILAB_POST_LAUNCH_PATH || '/',
    tokenEncryptionKey: env.ILAB_TOKEN_ENCRYPTION_KEY ?? '',
    handoffTtlSeconds: int(env.ILAB_HANDOFF_TTL_SECONDS, 60),
    expectTimeConfigPath: env.ILAB_EXPECT_TIME_CONFIG || resolve(process.cwd(), 'config/step-expect-time.pending.json'),
    scorePolicy: pick(env.ILAB_SCORE_POLICY, ['unconfirmed', 'preserve_weights_round', 'normalize_step_percent'] as const, 'unconfirmed'),
    aiCountPolicy: pick(env.ILAB_AI_COUNT_POLICY, ['unconfirmed', 'response_received', 'dispatched'] as const, 'unconfirmed'),
    timeExportPolicy: pick(env.ILAB_TIME_EXPORT_POLICY, ['unconfirmed', 'floor_seconds'] as const, 'unconfirmed'),
    incompleteUploadsEnabled: bool(env.ILAB_INCOMPLETE_UPLOADS_ENABLED),
    outboundCallBudget: int(env.ILAB_OUTBOUND_CALL_BUDGET, 8),
    maxAttachmentBytes: Math.min(int(env.ILAB_MAX_ATTACHMENT_BYTES, 5_000_000), 5_000_000),
    productionAuthorized: bool(env.ILAB_PRODUCTION_AUTHORIZED),
    aiModel: {
      model: env.AI_MODEL ?? '',
      version: env.ILAB_AI_MODEL_VERSION ?? '',
      deployment: env.ILAB_AI_DEPLOYMENT ?? '',
      provider: env.ILAB_AI_PROVIDER ?? ''
    }
  };
}

let current: IlabConfig = loadIlabConfig();

export function ilabConfig(): IlabConfig {
  return current;
}

/** 仅测试使用：替换配置 */
export function setIlabConfig(next: IlabConfig): void {
  current = next;
}

export function endpointFor(config: IlabConfig, environment: IlabMode): EnvEndpoint {
  if (environment === 'mock') return { baseUrl: MOCK_BASE_URL, appid: MOCK_APPID, secret: MOCK_SECRET };
  return environment === 'test' ? config.test : config.production;
}

/** 教师确认的合理用时；null 表示未确认，不能替换为任何默认值 */
export function loadExpectTimes(config: IlabConfig): Record<string, number | null> {
  const path = config.expectTimeConfigPath;
  const result: Record<string, number | null> = {};
  if (!existsSync(path)) return result;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { steps?: Array<{ stepId: string; expectTimeSec: number | null }> };
    for (const step of parsed.steps ?? []) {
      const value = step.expectTimeSec;
      result[step.stepId] = Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
    }
  } catch {
    // 配置损坏：全部视为未确认
  }
  return result;
}

/** 合成会话专用的测试用时常量（来自 fixtures），只能用于 synthetic，不得用于真实会话 */
export const SYNTHETIC_EXPECT_TIME_SEC = 60;

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 生产就绪清单：只报告“是否已配置/已确认”，不输出任何密钥值 */
export function productionReadiness(config: IlabConfig): ReadinessItem[] {
  const expect = loadExpectTimes(config);
  const confirmedExpect = Object.values(expect).filter((value) => value !== null).length;
  const prodUrl = (() => {
    try {
      const url = new URL(config.production.baseUrl);
      return url.protocol === 'https:' && url.hostname === 'www.ilab-x.com';
    } catch {
      return false;
    }
  })();
  const origin = (() => {
    try {
      const url = new URL(config.publicOrigin);
      return url.protocol === 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
    } catch {
      return false;
    }
  })();
  return [
    { key: 'authorized', label: '学校授权正式接入', ok: config.productionAuthorized, detail: config.productionAuthorized ? '已设置 ILAB_PRODUCTION_AUTHORIZED' : '未授权（ILAB_PRODUCTION_AUTHORIZED=false）' },
    { key: 'prodCredentials', label: '正式 appid / SECRET', ok: Boolean(config.production.appid && config.production.secret), detail: config.production.appid && config.production.secret ? '已在服务器私有配置' : '未配置' },
    { key: 'prodBaseUrl', label: '正式基址含 www 且为 HTTPS', ok: prodUrl, detail: prodUrl ? 'https://www.ilab-x.com' : '基址不符合要求' },
    { key: 'publicOrigin', label: '学校 HTTPS 实验入口', ok: origin, detail: origin ? config.publicOrigin : '仍为本机或非 HTTPS 地址' },
    { key: 'tokenKey', label: '令牌加密密钥', ok: config.tokenEncryptionKey.length >= 32, detail: config.tokenEncryptionKey.length >= 32 ? '已配置' : '未配置（至少 32 字符）' },
    { key: 'expectTime', label: '24 步合理用时（教师确认）', ok: confirmedExpect === 24, detail: `已确认 ${confirmedExpect}/24` },
    { key: 'scorePolicy', label: '整数成绩导出口径', ok: config.scorePolicy !== 'unconfirmed', detail: config.scorePolicy },
    { key: 'aiCountPolicy', label: 'AI 调用计次口径', ok: config.aiCountPolicy !== 'unconfirmed', detail: config.aiCountPolicy },
    { key: 'timePolicy', label: '时间整秒导出口径', ok: config.timeExportPolicy !== 'unconfirmed', detail: config.timeExportPolicy },
    { key: 'aiModelMeta', label: '真实模型名称 / 版本 / 部署方式', ok: Boolean(config.aiModel.model && config.aiModel.version && (DEPLOYMENTS as readonly string[]).includes(config.aiModel.deployment)), detail: config.aiModel.model ? `模型已配置，版本${config.aiModel.version ? '已填' : '未填'}，部署方式${config.aiModel.deployment || '未填'}` : '未配置真实模型（本地规则兜底，不计 AI 调用）' },
    { key: 'reportFont', label: '报告 PDF 中文字体（嵌入）', ok: resolveReportFont() !== null, detail: resolveReportFont()?.path ?? '未找到，请安装 Noto Sans CJK 并设置 ILAB_REPORT_FONT_PATH' },
    { key: 'network', label: '外连开关', ok: config.networkEnabled, detail: config.networkEnabled ? '已开启' : '关闭（ILAB_NETWORK_ENABLED=false）' },
    { key: 'testEvidence', label: '官方测试环境联调证据', ok: false, detail: '需人工核验后记录，代码无法自动判定' },
    { key: 'security', label: '等保二级与第三方测评材料', ok: false, detail: '由学校与测评机构提供，代码测试不能替代' }
  ];
}
