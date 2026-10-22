import { DEPLOYMENTS } from './config.js';

/**
 * 依据 ilab-integration-kit-20261021/spec/result-upload.schema.json 与 ai-data.schema.json
 * 的逐字段校验，外加跨字段时间/范围检查。返回空数组表示通过。
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

const ROOT_KEYS = new Set(['username', 'title', 'childProjectTitle', 'status', 'score', 'startTime', 'endTime', 'timeUsed', 'appid', 'originId', 'steps', 'group_id', 'group_name', 'role_in_group', 'group_members', 'ext_data', 'ai_data']);
const STEP_KEYS = new Set(['seq', 'title', 'startTime', 'endTime', 'timeUsed', 'expectTime', 'maxScore', 'score', 'repeatCount', 'evaluation', 'scoringModel', 'remarks', 'ext_data']);
const STEP_REQUIRED = ['seq', 'title', 'startTime', 'endTime', 'timeUsed', 'expectTime', 'maxScore', 'score', 'repeatCount', 'evaluation', 'scoringModel'];
const AI_KEYS = new Set(['ai_call_count', 'ai_models_used', 'ai_usage_scenarios', 'ai_input_token_count', 'ai_output_token_count', 'ai_remark']);
const MODEL_KEYS = new Set(['model', 'version', 'deployment', 'provider']);

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const len = (value: string) => [...value].length;
const isMs = (value: unknown) => isInt(value) && value >= 1_000_000_000_000 && value <= 9_999_999_999_999;

export function validateAiData(value: unknown, path = 'ai_data'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObj(value)) return [{ path, message: '必须是对象' }];
  for (const key of Object.keys(value)) if (!AI_KEYS.has(key)) issues.push({ path: `${path}.${key}`, message: '不允许的字段' });
  const count = value.ai_call_count;
  if (!isInt(count) || count < 0) issues.push({ path: `${path}.ai_call_count`, message: '必须是非负整数' });
  const models = value.ai_models_used;
  const scenarios = value.ai_usage_scenarios;
  if (!Array.isArray(models)) issues.push({ path: `${path}.ai_models_used`, message: '必须是数组' });
  if (!Array.isArray(scenarios)) issues.push({ path: `${path}.ai_usage_scenarios`, message: '必须是数组' });
  if (Array.isArray(models)) {
    models.forEach((model, index) => {
      const at = `${path}.ai_models_used[${index}]`;
      if (!isObj(model)) {
        issues.push({ path: at, message: '必须是对象' });
        return;
      }
      for (const key of Object.keys(model)) if (!MODEL_KEYS.has(key)) issues.push({ path: `${at}.${key}`, message: '不允许的字段' });
      for (const key of ['model', 'version'] as const) {
        if (typeof model[key] !== 'string' || !(model[key] as string).trim()) issues.push({ path: `${at}.${key}`, message: '必填非空字符串' });
      }
      if (!(DEPLOYMENTS as readonly unknown[]).includes(model.deployment)) issues.push({ path: `${at}.deployment`, message: `只能是 ${DEPLOYMENTS.join('/')}` });
      if (model.provider !== undefined && typeof model.provider !== 'string') issues.push({ path: `${at}.provider`, message: '必须是字符串' });
    });
  }
  if (Array.isArray(scenarios)) {
    scenarios.forEach((scenario, index) => {
      if (typeof scenario !== 'string' || !scenario.trim()) issues.push({ path: `${path}.ai_usage_scenarios[${index}]`, message: '元素必须是非空字符串' });
    });
  }
  if (isInt(count) && count > 0) {
    if (Array.isArray(models) && models.length === 0) issues.push({ path: `${path}.ai_models_used`, message: '调用次数大于 0 时不能为空' });
    if (Array.isArray(scenarios) && scenarios.length === 0) issues.push({ path: `${path}.ai_usage_scenarios`, message: '调用次数大于 0 时不能为空' });
  }
  for (const key of ['ai_input_token_count', 'ai_output_token_count'] as const) {
    if (value[key] !== undefined && (!isInt(value[key]) || (value[key] as number) < 0)) issues.push({ path: `${path}.${key}`, message: '必须是非负整数（未知时省略）' });
  }
  if (value.ai_remark !== undefined && typeof value.ai_remark !== 'string') issues.push({ path: `${path}.ai_remark`, message: '必须是字符串' });
  return issues;
}

export function validateResultPayload(value: unknown, nowMs = Date.now()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObj(value)) return [{ path: '$', message: '必须是 JSON 对象' }];
  for (const key of Object.keys(value)) if (!ROOT_KEYS.has(key)) issues.push({ path: key, message: '不允许的根字段' });
  for (const key of ['username', 'title', 'appid']) {
    if (typeof value[key] !== 'string' || !(value[key] as string)) issues.push({ path: key, message: '必填非空字符串' });
  }
  if (typeof value.title === 'string' && len(value.title) > 100) issues.push({ path: 'title', message: '不超过 100 字' });
  if (value.childProjectTitle !== undefined && (typeof value.childProjectTitle !== 'string' || len(value.childProjectTitle) > 100)) issues.push({ path: 'childProjectTitle', message: '不超过 100 字' });
  if (value.status !== 1 && value.status !== 2) issues.push({ path: 'status', message: '只能是 1 或 2' });
  if (!isInt(value.score) || value.score < 0 || value.score > 100) issues.push({ path: 'score', message: '必须是 0–100 整数' });
  if (!isMs(value.startTime)) issues.push({ path: 'startTime', message: '必须是 13 位毫秒时间戳' });
  if (!isMs(value.endTime)) issues.push({ path: 'endTime', message: '必须是 13 位毫秒时间戳' });
  if (!isInt(value.timeUsed) || value.timeUsed < 1) issues.push({ path: 'timeUsed', message: '必须是正整数秒' });
  if (typeof value.originId !== 'string' || !/^[A-Za-z0-9_]+$/.test(value.originId)) issues.push({ path: 'originId', message: '只能包含字母、数字、下划线' });
  for (const key of ['group_id', 'group_name', 'role_in_group'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || len(value[key] as string) > 20)) issues.push({ path: key, message: '不超过 20 字符' });
  }
  if (value.ext_data !== undefined && !isObj(value.ext_data)) issues.push({ path: 'ext_data', message: '必须是对象' });

  const start = value.startTime as number;
  const end = value.endTime as number;
  if (isMs(start) && isMs(end)) {
    if (end < start) issues.push({ path: 'endTime', message: '早于开始时间' });
    if (end > nowMs) issues.push({ path: 'endTime', message: '晚于当前时间' });
    if (isInt(value.timeUsed) && value.timeUsed !== Math.round((end - start) / 1000)) issues.push({ path: 'timeUsed', message: '与起止时间不一致' });
  }

  if (!Array.isArray(value.steps)) {
    issues.push({ path: 'steps', message: '必须是数组' });
  } else {
    if (value.steps.length > 200) issues.push({ path: 'steps', message: '最多 200 步' });
    if (value.status === 1 && value.steps.length < 10) issues.push({ path: 'steps', message: '完成记录至少 10 步' });
    value.steps.forEach((step, index) => {
      const at = `steps[${index}]`;
      if (!isObj(step)) {
        issues.push({ path: at, message: '必须是对象' });
        return;
      }
      for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) issues.push({ path: `${at}.${key}`, message: '不允许的步骤字段' });
      for (const key of STEP_REQUIRED) if (step[key] === undefined || step[key] === null) issues.push({ path: `${at}.${key}`, message: '必填' });
      if (step.seq !== undefined && (!isInt(step.seq) || step.seq < 1)) issues.push({ path: `${at}.seq`, message: '正整数' });
      if (typeof step.title !== 'string' || !step.title || len(step.title) > 100) issues.push({ path: `${at}.title`, message: '1–100 字' });
      for (const key of ['evaluation', 'scoringModel', 'remarks'] as const) {
        if (step[key] !== undefined && (typeof step[key] !== 'string' || len(step[key] as string) > 200)) issues.push({ path: `${at}.${key}`, message: '字符串且不超过 200 字' });
      }
      for (const key of ['maxScore', 'score'] as const) {
        if (step[key] !== undefined && (!isInt(step[key]) || (step[key] as number) < 0 || (step[key] as number) > 100)) issues.push({ path: `${at}.${key}`, message: '0–100 整数' });
      }
      if (isInt(step.score) && isInt(step.maxScore) && step.score > step.maxScore) issues.push({ path: `${at}.score`, message: '超过本步满分' });
      for (const key of ['timeUsed', 'expectTime', 'repeatCount'] as const) {
        if (step[key] !== undefined && step[key] !== null && (!isInt(step[key]) || (step[key] as number) < 1)) issues.push({ path: `${at}.${key}`, message: '正整数' });
      }
      if (step.startTime !== undefined && !isMs(step.startTime)) issues.push({ path: `${at}.startTime`, message: '13 位毫秒时间戳' });
      if (step.endTime !== undefined && !isMs(step.endTime)) issues.push({ path: `${at}.endTime`, message: '13 位毫秒时间戳' });
      if (isMs(step.startTime) && isMs(step.endTime)) {
        const s = step.startTime as number;
        const e = step.endTime as number;
        if (e < s) issues.push({ path: `${at}.endTime`, message: '早于本步开始' });
        if (isMs(start) && s < start) issues.push({ path: `${at}.startTime`, message: '早于整体实验开始' });
        if (isMs(end) && e > end) issues.push({ path: `${at}.endTime`, message: '晚于整体实验结束' });
        if (isInt(step.timeUsed) && step.timeUsed !== Math.round((e - s) / 1000)) issues.push({ path: `${at}.timeUsed`, message: '与本步起止不一致' });
      }
      if (step.ext_data !== undefined && !isObj(step.ext_data)) issues.push({ path: `${at}.ext_data`, message: '必须是对象' });
    });
  }

  if (value.status === 1 && value.ai_data === undefined) issues.push({ path: 'ai_data', message: '2026 完成记录必须包含 ai_data' });
  if (value.ai_data !== undefined) issues.push(...validateAiData(value.ai_data));
  return issues;
}
