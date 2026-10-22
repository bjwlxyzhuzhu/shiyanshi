import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 临时数据库：绝不使用学校/本机的真实数据文件
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'zhian-test-')), 'test.sqlite');
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ILAB_') || key.startsWith('AI_')) delete process.env[key];
}

// 拦截一切外连：只允许访问测试内启动的本机服务
const realFetch = globalThis.fetch;
export const blockedFetches: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) return realFetch(input, init);
  blockedFetches.push(url);
  throw new TypeError(`BLOCKED_EXTERNAL_FETCH ${new URL(url).host}`);
}) as typeof fetch;
