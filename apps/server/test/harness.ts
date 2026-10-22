import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { STEPS, joinList, type StepDefinition } from '@zhian/shared';
import { createApp } from '../src/app.js';
import { loadIlabConfig, setIlabConfig, type IlabConfig } from '../src/ilab/config.js';

export interface Harness {
  base: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<Harness> {
  const server: Server = await new Promise((resolve) => {
    const instance = createApp().listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export function configure(overrides: Partial<IlabConfig> = {}): IlabConfig {
  const config = { ...loadIlabConfig({}), ...overrides };
  setIlabConfig(config);
  return config;
}

/** 模拟“我要做实验”：取得合成 ticket → /ilab/launch → handoff cookie → bootstrap */
export async function launch(base: string, un = 'synthetic_student_01') {
  const issued = await fetch(`${base}/api/ilab/mock/launch-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ un }) }).then((r) => r.json()) as { url: string };
  const launchRes = await fetch(`${base}${issued.url}`, { redirect: 'manual' });
  const cookie = (launchRes.headers.get('set-cookie') ?? '').split(';')[0]!;
  const location = launchRes.headers.get('location') ?? '';
  const boot = await fetch(`${base}/api/ilab/bootstrap`, { method: 'POST', headers: { cookie } });
  const body = await boot.json() as { token: string; user: { id: number; username: string; role: string }; sessionId: number; ilab: { environment: string; synthetic: boolean } };
  return { launchStatus: launchRes.status, location, cookie, launchUrl: issued.url, bootStatus: boot.status, ...body };
}

export function api(base: string, token: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON（如 PDF） */ }
    return { status: res.status, json: json as any, text };
  };
  return { get: (path: string) => call('GET', path), post: (path: string, body?: unknown) => call('POST', path, body ?? {}) };
}

/** 一个“真实操作”的输入：在默认值基础上做一次改动，保证不是原样提交 */
export function changedInput(step: StepDefinition): Record<string, number | string> {
  const input: Record<string, number | string> = {};
  for (const field of step.fields) {
    if (field.kind === 'order') input[field.key] = joinList([...(field.options ?? [])].reverse());
    else if (field.kind === 'checklist') input[field.key] = joinList((field.options ?? []).slice(0, 1));
    else if (field.kind === 'select') input[field.key] = field.options?.[1] ?? field.options?.[0] ?? '';
    else if (field.kind === 'number') input[field.key] = Number(field.default ?? field.min ?? 0) + (field.step ?? 1);
    else input[field.key] = 'x';
  }
  return input;
}

export const STEP_LIST = STEPS;
