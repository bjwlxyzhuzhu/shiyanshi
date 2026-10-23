import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, dbPath, nowIso } from '../db.js';
import { DEPLOYMENTS, ilabConfig } from '../ilab/config.js';
import { decryptSecret, encryptSecret } from '../ilab/signature.js';

/**
 * 真实大模型配置（管理员在服务器端维护）。
 * - API Key 只写不读：AES-256-GCM 加密存库，接口只返回“已配置 + 末 4 位”，不进日志、不发前端。
 * - 加密密钥：SETTINGS_ENCRYPTION_KEY；未设置时在数据目录生成持久随机密钥文件（不入仓库）。
 * - 优先使用管理员配置；未配置或停用时回退到 .env 的 AI_BASE_URL / AI_API_KEY / AI_MODEL。
 */
export type ProviderPreset = 'deepseek_official' | 'tokenone_relay' | 'custom';

export interface PresetInfo {
  id: ProviderPreset;
  label: string;
  /** null 表示须由管理员填写（不猜测中转站地址） */
  baseUrl: string | null;
  models: string[];
  provider: string;
  deployment: (typeof DEPLOYMENTS)[number];
  note: string;
}

/** DeepSeek 官方信息核对于 2026-10-23（api-docs.deepseek.com）；上线前请管理员复核版本号 */
export const PRESETS: PresetInfo[] = [
  {
    id: 'deepseek_official',
    label: 'DeepSeek 官方 API',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    provider: '深度求索（DeepSeek）',
    deployment: '公有云服务',
    note: 'OpenAI 兼容接口 /chat/completions。截至 2026-10-23 文档，deepseek-flash 对应 DeepSeek-V4.1-Flash-1017。'
  },
  {
    id: 'tokenone_relay',
    label: 'TokenONE 中转站（deepseek 分组）',
    baseUrl: null,
    models: [],
    provider: 'TokenONE 中转（上游 DeepSeek）',
    deployment: '公有云服务',
    note: '请填写中转站控制台给出的 API 地址（OpenAI 兼容）与 deepseek 分组下的模型名。第三方中转会经手请求内容，须经学校同意，且提示词中不得包含学生个人信息。'
  },
  {
    id: 'custom',
    label: '其他 OpenAI 兼容服务',
    baseUrl: null,
    models: [],
    provider: '',
    deployment: '公有云服务',
    note: '学校私有化部署或其他兼容服务。'
  }
];

interface StoredModelSettings {
  enabled: boolean;
  preset: ProviderPreset;
  baseUrl: string;
  model: string;
  version: string;
  deployment: string;
  provider: string;
  apiKeyEnc: string | null;
  apiKeyLast4: string | null;
}

export interface EffectiveModelConfig {
  source: 'admin' | 'env';
  baseUrl: string;
  apiKey: string;
  model: string;
  version: string;
  deployment: string;
  provider: string;
}

export interface PublicModelSettings {
  enabled: boolean;
  preset: ProviderPreset;
  baseUrl: string;
  model: string;
  version: string;
  deployment: string;
  provider: string;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  /** 当前实际生效的来源：admin（管理员配置）、env（服务器环境变量）、none（规则兜底） */
  effectiveSource: 'admin' | 'env' | 'none';
  keyStorage: 'env_key' | 'local_key_file';
  updatedAt: string | null;
}

const SETTINGS_KEY = 'ai_model';

let cachedKey: string | null = null;

function settingsKey(): string {
  if (process.env.SETTINGS_ENCRYPTION_KEY) return process.env.SETTINGS_ENCRYPTION_KEY;
  if (cachedKey) return cachedKey;
  const file = resolve(dirname(dbPath), 'settings.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600 });
  cachedKey = readFileSync(file, 'utf8').trim();
  return cachedKey;
}

function load(): { value: StoredModelSettings; updatedAt: string } | null {
  const row = db.prepare('SELECT value_json, updated_at FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as { value_json: string; updated_at: string } | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value_json) as StoredModelSettings, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

function envConfig(): EffectiveModelConfig | null {
  const { AI_BASE_URL: baseUrl, AI_API_KEY: apiKey, AI_MODEL: model } = process.env;
  if (!baseUrl || !apiKey || !model) return null;
  const meta = ilabConfig().aiModel;
  return { source: 'env', baseUrl, apiKey, model, version: meta.version, deployment: meta.deployment, provider: meta.provider };
}

export function effectiveModelConfig(): EffectiveModelConfig | null {
  const stored = load()?.value;
  if (stored?.enabled && stored.baseUrl && stored.model && stored.apiKeyEnc) {
    const apiKey = decryptSecret(stored.apiKeyEnc, settingsKey());
    if (apiKey) {
      return { source: 'admin', baseUrl: stored.baseUrl, apiKey, model: stored.model, version: stored.version, deployment: stored.deployment, provider: stored.provider };
    }
  }
  return envConfig();
}

/** 供就绪清单与审计使用的元数据（不含密钥） */
export function effectiveModelMeta(): { model: string; version: string; deployment: string; provider: string } | null {
  const config = effectiveModelConfig();
  return config ? { model: config.model, version: config.version, deployment: config.deployment, provider: config.provider } : null;
}

export function publicModelSettings(): PublicModelSettings {
  const loaded = load();
  const stored = loaded?.value;
  const effective = effectiveModelConfig();
  return {
    enabled: stored?.enabled ?? false,
    preset: stored?.preset ?? 'deepseek_official',
    baseUrl: stored?.baseUrl ?? '',
    model: stored?.model ?? '',
    version: stored?.version ?? '',
    deployment: stored?.deployment ?? '公有云服务',
    provider: stored?.provider ?? '',
    apiKeyConfigured: Boolean(stored?.apiKeyEnc),
    apiKeyLast4: stored?.apiKeyLast4 ?? null,
    effectiveSource: effective?.source ?? 'none',
    keyStorage: process.env.SETTINGS_ENCRYPTION_KEY ? 'env_key' : 'local_key_file',
    updatedAt: loaded?.updatedAt ?? null
  };
}

export class SettingsError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

/** 只允许 HTTPS（本机调试可用 http://localhost）；不带查询串与凭据 */
export function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SettingsError('baseUrl', 'API 地址格式不正确');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new SettingsError('baseUrl', 'API 地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new SettingsError('baseUrl', 'API 地址不能包含账号、查询参数或锚点');
  return url.href.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

export interface ModelSettingsInput {
  enabled?: unknown;
  preset?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  version?: unknown;
  deployment?: unknown;
  provider?: unknown;
  /** 留空表示保持原密钥不变 */
  apiKey?: unknown;
  clearApiKey?: unknown;
}

export function saveModelSettings(input: ModelSettingsInput, actorId: number): PublicModelSettings {
  const previous = load()?.value;
  const preset = PRESETS.find((item) => item.id === input.preset)?.id ?? 'custom';
  const presetInfo = PRESETS.find((item) => item.id === preset)!;
  const enabled = input.enabled === true;
  const baseUrlRaw = cleanText(input.baseUrl, 300) || presetInfo.baseUrl || '';
  const baseUrl = baseUrlRaw ? validateBaseUrl(baseUrlRaw) : '';
  const model = cleanText(input.model, 100);
  if (model && !/^[\w.:/-]+$/.test(model)) throw new SettingsError('model', '模型名只能包含字母、数字和 . _ : / -');
  const deployment = cleanText(input.deployment, 20) || presetInfo.deployment;
  if (!(DEPLOYMENTS as readonly string[]).includes(deployment)) throw new SettingsError('deployment', `部署方式只能是：${DEPLOYMENTS.join('、')}`);

  let apiKeyEnc = previous?.apiKeyEnc ?? null;
  let apiKeyLast4 = previous?.apiKeyLast4 ?? null;
  const apiKey = String(input.apiKey ?? '').trim();
  if (input.clearApiKey === true) {
    apiKeyEnc = null;
    apiKeyLast4 = null;
  } else if (apiKey) {
    if (apiKey.length < 16 || apiKey.length > 300 || /\s/.test(apiKey)) throw new SettingsError('apiKey', 'API Key 格式不正确');
    apiKeyEnc = encryptSecret(apiKey, settingsKey());
    apiKeyLast4 = apiKey.slice(-4);
  }

  if (enabled) {
    if (!baseUrl) throw new SettingsError('baseUrl', '启用前请填写 API 地址');
    if (!model) throw new SettingsError('model', '启用前请填写模型名');
    if (!apiKeyEnc) throw new SettingsError('apiKey', '启用前请填写 API Key');
  }

  const value: StoredModelSettings = {
    enabled,
    preset,
    baseUrl,
    model,
    version: cleanText(input.version, 100),
    deployment,
    provider: cleanText(input.provider, 100) || presetInfo.provider,
    apiKeyEnc,
    apiKeyLast4
  };
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(SETTINGS_KEY, JSON.stringify(value), actorId, nowIso());
  // 审计只记录变更了哪些项，不记录密钥
  const changed: string[] = (['enabled', 'preset', 'baseUrl', 'model', 'version', 'deployment', 'provider'] as const).filter((key) => previous?.[key] !== value[key]);
  if (apiKeyEnc !== (previous?.apiKeyEnc ?? null)) changed.push(input.clearApiKey === true ? 'apiKey:cleared' : 'apiKey:replaced');
  db.prepare('INSERT INTO admin_audit (actor_id, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actorId, 'model_settings.update', SETTINGS_KEY, JSON.stringify({ changed }), nowIso());
  return publicModelSettings();
}
