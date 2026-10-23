import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, configure, launch, startServer, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  configure();
  h = await startServer();
});
afterAll(() => h.close());

describe('研究探索（选做，不计分）', () => {
  it('至少 3 组不同参数才能提交结论；反馈依据试验数据给出变化方向', async () => {
    const user = await launch(h.base, 'synthetic_explorer');
    const client = api(h.base, user.token);
    const list = await client.get('/api/explore');
    expect(list.json.explorations.map((e: { id: string }) => e.id)).toEqual(['E1', 'E2', 'E3']);
    for (const fan of [30, 60]) await client.post('/api/explore/E1/run', { params: { fanPct: fan, ambientC: 24, loadPct: 90 } });
    const early = await client.post('/api/explore/E1/conclude', { hypothesis: '风扇转速越高温度越低', conclusion: '数据表明风扇转速提高后峰值温度下降' });
    expect(early.json.code).toBe('TOO_FEW_TRIALS');
    const third = await client.post('/api/explore/E1/run', { params: { fanPct: 90, ambientC: 24, loadPct: 90 } });
    expect(third.json.trials).toHaveLength(3);
    expect(third.json.metrics.peakC).toBeLessThan(third.json.trials[0].metrics.peakC);
    const done = await client.post('/api/explore/E1/conclude', { hypothesis: '风扇转速越高温度越低', conclusion: '数据表明风扇转速提高后峰值温度下降' });
    expect(done.json.feedback).toContain('风扇转速从 30% 增至 90%，峰值温度下降');
  });

  it('参数越界会被限制在允许范围内', async () => {
    const user = await launch(h.base, 'synthetic_explorer2');
    const res = await api(h.base, user.token).post('/api/explore/E3/run', { params: { threshold: 99 } });
    expect(res.json.params.threshold).toBe(5);
    expect(res.json.metrics.f1).toBeGreaterThanOrEqual(0);
  });
});
