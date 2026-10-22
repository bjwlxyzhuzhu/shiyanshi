import { describe, expect, it } from 'vitest';
import { buildQuery, md5Upper, newOriginId, rawQueryParam, redactUrl, ticketSignature, tokenSignature, encryptSecret, decryptSecret } from '../src/ilab/signature.js';
import { validateAiData, validateResultPayload } from '../src/ilab/validate.js';

describe('签名与 ticket 编码', () => {
  it('MD5 为 UTF-8 原文、大写十六进制', () => {
    expect(md5Upper('')).toBe('D41D8CD98F00B204E9800998ECF8427E');
    expect(md5Upper('中')).toBe(md5Upper('中'));
    expect(ticketSignature('T+1', '10000', 'S')).toBe(md5Upper('T+110000S'));
    expect(tokenSignature('tok', 'app', 'sec')).toBe(md5Upper('tokappsec'));
  });

  it('原始 + 保持为加号，%2B 解码为加号，/ 与 = 原样保留', () => {
    expect(rawQueryParam('/ilab/launch?ticket=a+b%2Bc/d==', 'ticket')).toBe('a+b+c/d==');
  });

  it('只解码一次：%252B 得到字面量 %2B，不再二次解码', () => {
    expect(rawQueryParam('/ilab/launch?ticket=x%252By', 'ticket')).toBe('x%2By');
  });

  it('Unicode 与缺失/非法编码', () => {
    expect(rawQueryParam('/ilab/launch?ticket=%E4%B8%AD%E6%96%87', 'ticket')).toBe('中文');
    expect(rawQueryParam('/ilab/launch', 'ticket')).toBeNull();
    expect(rawQueryParam('/ilab/launch?ticket=', 'ticket')).toBeNull();
    expect(rawQueryParam('/ilab/launch?ticket=%E4%B8', 'ticket')).toBeNull();
  });

  it('出站只编码一次，且往返后得到原文', () => {
    const ticket = 'AB+c/d=e 中';
    const query = buildQuery({ ticket, appid: '10000' });
    expect(query).toContain('ticket=AB%2Bc%2Fd%3De%20%E4%B8%AD');
    expect(query).not.toContain('%25');
    expect(rawQueryParam(`/x?${query}`, 'ticket')).toBe(ticket);
  });

  it('日志脱敏 ticket / access_token / signature', () => {
    expect(redactUrl('/ilab/launch?ticket=SECRET&x=1')).toBe('/ilab/launch?ticket=[redacted]&x=1');
    expect(redactUrl('/a?access_token=T&signature=S')).toBe('/a?access_token=[redacted]&signature=[redacted]');
  });

  it('令牌加密可解密，错误密钥无法解密', () => {
    const sealed = encryptSecret('token-value', 'k'.repeat(32));
    expect(sealed).not.toContain('token-value');
    expect(decryptSecret(sealed, 'k'.repeat(32))).toBe('token-value');
    expect(decryptSecret(sealed, 'x'.repeat(32))).toBeNull();
  });

  it('originId 只含字母数字下划线且不重复', () => {
    const a = newOriginId('mock');
    const b = newOriginId('mock');
    expect(a).toMatch(/^[A-Za-z0-9_]+$/);
    expect(a).not.toBe(b);
  });
});

describe('ai_data 严格结构', () => {
  const model = { model: 'm', version: 'v1', deployment: '私有化部署' };
  it('0 次调用允许空数组', () => {
    expect(validateAiData({ ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] })).toEqual([]);
  });
  it('调用次数 > 0 时模型与场景不能为空，场景元素不能为空串', () => {
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [], ai_usage_scenarios: ['x'] }).length).toBeGreaterThan(0);
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [model], ai_usage_scenarios: [] }).length).toBeGreaterThan(0);
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [model], ai_usage_scenarios: [''] }).length).toBeGreaterThan(0);
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [model], ai_usage_scenarios: ['评审'] })).toEqual([]);
  });
  it('拒绝多余字段、非法部署方式、负数与非整数', () => {
    expect(validateAiData({ ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [], extra: 1 }).length).toBe(1);
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [{ ...model, deployment: '云端' }], ai_usage_scenarios: ['a'] }).length).toBe(1);
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [{ ...model, size: '7B' }], ai_usage_scenarios: ['a'] }).length).toBe(1);
    expect(validateAiData({ ai_call_count: -1, ai_models_used: [], ai_usage_scenarios: [] }).length).toBeGreaterThan(0);
    expect(validateAiData({ ai_call_count: 1.5, ai_models_used: [model], ai_usage_scenarios: ['a'] }).length).toBeGreaterThan(0);
    expect(validateAiData({ ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [], ai_input_token_count: -3 }).length).toBe(1);
  });
  it('版本缺失不被接受（不能捏造 1.0，也不能留空）', () => {
    expect(validateAiData({ ai_call_count: 1, ai_models_used: [{ model: 'm', version: '', deployment: '本地运行' }], ai_usage_scenarios: ['a'] }).length).toBe(1);
  });
});

describe('回传结构与跨字段校验', () => {
  const now = 1_790_000_100_000;
  const step = (seq: number) => ({
    seq, title: `步骤${seq}`, startTime: 1_790_000_000_000 + seq * 1000, endTime: 1_790_000_000_000 + seq * 1000 + 3000, timeUsed: 3,
    expectTime: 60, maxScore: 4, score: 2, repeatCount: 1, evaluation: 'ok', scoringModel: 'rule', remarks: ''
  });
  const base = () => ({
    username: 'u', title: '实验', status: 1, score: 50, startTime: 1_790_000_000_000, endTime: 1_790_000_030_000, timeUsed: 30,
    appid: 'a', originId: 'zhian_mock_1', steps: Array.from({ length: 10 }, (_, i) => step(i + 1)),
    ai_data: { ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] }
  });
  it('合法负载通过', () => {
    expect(validateResultPayload(base(), now)).toEqual([]);
  });
  it('带连字符的 UUID 不能作 originId', () => {
    expect(validateResultPayload({ ...base(), originId: '1f0c-22aa' }, now).map((i) => i.path)).toContain('originId');
  });
  it('完成记录少于 10 步、缺 ai_data、成绩为小数都拒绝', () => {
    expect(validateResultPayload({ ...base(), steps: base().steps.slice(0, 9) }, now).map((i) => i.path)).toContain('steps');
    const { ai_data: _drop, ...noAi } = base();
    expect(validateResultPayload(noAi, now).map((i) => i.path)).toContain('ai_data');
    expect(validateResultPayload({ ...base(), score: 50.5 }, now).map((i) => i.path)).toContain('score');
  });
  it('用时与起止不一致、步骤超出整体范围、未来时间都拒绝', () => {
    expect(validateResultPayload({ ...base(), timeUsed: 31 }, now).map((i) => i.path)).toContain('timeUsed');
    const steps = base().steps;
    steps[0] = { ...steps[0]!, startTime: 1_789_999_999_000, timeUsed: 4 };
    expect(validateResultPayload({ ...base(), steps }, now).some((i) => i.message.includes('早于整体'))).toBe(true);
    expect(validateResultPayload(base(), 1_790_000_010_000).some((i) => i.message.includes('晚于当前'))).toBe(true);
  });
  it('秒级时间戳（10 位）不被当作毫秒', () => {
    expect(validateResultPayload({ ...base(), startTime: 1_790_000_000 }, now).map((i) => i.path)).toContain('startTime');
  });
  it('拒绝根级 remarks 等未定义字段', () => {
    expect(validateResultPayload({ ...base(), remarks: '' }, now).map((i) => i.path)).toContain('remarks');
  });
});
