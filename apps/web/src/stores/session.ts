import { useMemo } from 'react';
import { create } from 'zustand';
import {
  BANK_VERSION,
  getStep,
  joinList,
  nextStepId,
  type AiReviewResponse,
  type ChartData,
  type PreviewImage,
  type SessionState,
  type StepDefinition,
  type StepResult,
  type User
} from '@zhian/shared';
import { api, getStoredUser, getToken, setAuth, type IlabStatus, type IlabSyncResult, type ProfileItem, type StepEventType } from '../api';

type Input = Record<string, number | string>;

const SESSION_KEY = 'zhian.session';

/** 支持实时预览的步骤：只取后端 chart / preview，不含分数 */
export const PREVIEW_STEPS = new Set(['S06', 'S08', 'S11', 'S14', 'S16', 'S22']);

let starting: Promise<void> | null = null;
const previewTimers = new Map<string, number>();
const lastInteract = new Map<string, number>();

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function readSessionId(): number | null {
  try {
    const value = Number(localStorage.getItem(SESSION_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSessionId(id: number | null): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, String(id));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 浏览器禁用存储时仅失去刷新恢复能力，不影响实验本身
  }
}

export function defaultsFor(step: StepDefinition): Input {
  const values: Input = {};
  for (const field of step.fields) {
    if (field.kind === 'order') values[field.key] = joinList(field.options ?? []);
    else values[field.key] = field.default ?? (field.kind === 'number' ? 0 : '');
  }
  return values;
}

/** 输入指纹：用于判断“当前输入是否就是上次提交的输入” */
export function inputHash(input: Input): string {
  return JSON.stringify(Object.keys(input).sort().map((key) => [key, input[key]]));
}

export interface PreviewState {
  status: 'loading' | 'ok' | 'error';
  chart: ChartData | null;
  preview: string | null;
  image?: PreviewImage | null;
  /** 当前图表对应的输入指纹；与最新输入不同时表示正在更新或已过期 */
  forHash: string | null;
}

export interface AsyncState<T> {
  status: 'idle' | 'loading' | 'ok' | 'error';
  data: T | null;
  error: string | null;
}

interface SessionStore {
  token: string | null;
  user: User | null;
  /** 教师/管理员可切换到管理后台 */
  page: 'experiment' | 'admin';
  setPage: (page: 'experiment' | 'admin') => void;
  setUser: (user: User) => void;
  /** 旧版题库的已提交记录：只读回看，重新提交按新题库评分 */
  legacy: Record<string, boolean>;
  session: SessionState | null;
  viewStepId: string;
  inputs: Record<string, Input>;
  results: Record<string, StepResult>;
  /** 每步最近一次正式提交的输入指纹 */
  submitted: Record<string, string>;
  previews: Record<string, PreviewState>;
  reviews: Record<string, AsyncState<AiReviewResponse>>;
  report: AsyncState<{ reportId: number; contentMd: string; profile: ProfileItem[] }>;
  /** 实验空间绑定与回传状态（本地练习时 bound=false） */
  ilab: IlabStatus | null;
  ilabSync: AsyncState<IlabSyncResult>;
  loading: boolean;
  submitting: string | null;
  submitError: { stepId: string; message: string } | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  start: () => Promise<void>;
  startOnce: () => Promise<void>;
  view: (stepId: string) => void;
  inputFor: (stepId: string) => Input;
  setField: (stepId: string, key: string, value: number | string) => void;
  isDirty: (stepId: string) => boolean;
  canSubmit: (stepId: string) => boolean;
  submit: (stepId: string) => Promise<boolean>;
  requestPreview: (stepId: string) => void;
  runReview: (stepId: string) => Promise<void>;
  runReport: () => Promise<void>;
  reset: () => Promise<void>;
  clearError: () => void;
  track: (stepId: string, type: StepEventType) => void;
  refreshIlab: () => Promise<void>;
  bootstrapIlab: () => Promise<boolean>;
  finalizeIlab: () => Promise<void>;
  reconcileIlab: () => Promise<void>;
  retryIlabAttachment: () => Promise<void>;
}

const idle = <T,>(): AsyncState<T> => ({ status: 'idle', data: null, error: null });

export const useSessionStore = create<SessionStore>((set, get) => ({
  token: getToken(),
  user: getStoredUser(),
  page: 'experiment',
  setPage: (page) => set({ page }),
  setUser: (user) => {
    setAuth(get().token, user);
    set({ user });
  },
  legacy: {},
  session: null,
  viewStepId: 'S01',
  inputs: {},
  results: {},
  submitted: {},
  previews: {},
  reviews: {},
  report: idle(),
  ilab: null,
  ilabSync: idle(),
  loading: false,
  submitting: null,
  submitError: null,
  error: null,

  clearError: () => set({ error: null, submitError: null }),

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.login(username, password);
      setAuth(data.token, data.user);
      set({ token: data.token, user: data.user, page: 'experiment', legacy: {}, loading: false, session: null, inputs: {}, results: {}, submitted: {}, previews: {}, reviews: {}, report: idle(), ilab: null, ilabSync: idle() });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '登录失败' });
    }
  },

  logout: () => {
    // 释放并发席位（失败不影响退出）
    if (getToken()) api.presence('leave').catch(() => undefined);
    setAuth(null, null);
    writeSessionId(null);
    set({ token: null, user: null, page: 'experiment', legacy: {}, session: null, inputs: {}, results: {}, submitted: {}, previews: {}, reviews: {}, report: idle(), ilab: null, ilabSync: idle(), error: null, submitError: null, viewStepId: 'S01' });
  },

  start: () => {
    starting ??= get().startOnce().finally(() => {
      starting = null;
    });
    return starting;
  },

  startOnce: async () => {
    set({ loading: true, error: null });
    try {
      const savedId = readSessionId();
      if (savedId) {
        const resumed = await api.session(savedId).catch(() => null);
        if (resumed) {
          const { records } = await api.records(savedId);
          const inputs: Record<string, Input> = {};
          const results: Record<string, StepResult> = {};
          const submitted: Record<string, string> = {};
          const legacy: Record<string, boolean> = {};
          for (const record of records) {
            if (record.bankVersion !== BANK_VERSION) {
              // 旧题库的输入字段与新题不一致：不回填，表单按新题默认值显示
              legacy[record.stepId] = true;
            } else {
              inputs[record.stepId] = record.input;
              submitted[record.stepId] = inputHash(record.input);
            }
            results[record.stepId] = {
              stepId: record.stepId,
              score: record.score,
              maxScore: record.maxScore,
              result: record.result,
              feedback: record.feedback,
              // 恢复的记录不含 nextStepId，进度以 SessionState 为准
              nextStepId: null
            };
          }
          set({ session: resumed, viewStepId: resumed.currentStepId, inputs, results, submitted, legacy, loading: false });
          void get().refreshIlab();
          return;
        }
      }
      const session = await api.start();
      writeSessionId(session.sessionId);
      set({ session, viewStepId: session.currentStepId, loading: false, results: {}, inputs: {}, submitted: {}, previews: {}, reviews: {}, report: idle() });
      void get().refreshIlab();
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法开始实验';
      if (message.includes('登录')) get().logout();
      set({ loading: false, error: message });
    }
  },

  view: (stepId) => set({ viewStepId: stepId, submitError: null }),

  inputFor: (stepId) => {
    const existing = get().inputs[stepId];
    if (existing) return existing;
    const step = getStep(stepId);
    return step ? defaultsFor(step) : {};
  },

  setField: (stepId, key, value) => {
    if (!get().canSubmit(stepId)) return;
    const current = get().inputFor(stepId);
    set({ inputs: { ...get().inputs, [stepId]: { ...current, [key]: value } } });
    get().track(stepId, 'interact');
    if (PREVIEW_STEPS.has(stepId)) get().requestPreview(stepId);
  },

  isDirty: (stepId) => {
    const submitted = get().submitted[stepId];
    return submitted !== undefined && submitted !== inputHash(get().inputFor(stepId));
  },

  /**
   * 只有当前步骤、或“刚提交、尚未进入下一步”的上一步可以提交。
   * 服务端重提历史步骤会把 current_step_id 拉回，所以其他历史步骤一律只读回看。
   */
  canSubmit: (stepId) => {
    const { session, results, ilab } = get();
    if (!session || ilab?.locked) return false;
    if (stepId === session.currentStepId) return true;
    return Boolean(results[stepId]) && nextStepId(stepId) === session.currentStepId && !results[session.currentStepId];
  },

  submit: async (stepId) => {
    const session = get().session;
    if (!session || get().submitting || !get().canSubmit(stepId)) return false;
    const input = get().inputFor(stepId);
    const hash = inputHash(input);
    set({ submitting: stepId, submitError: null });
    try {
      // 每次点击一个 requestId：网络重发同一请求时服务端不会重复计一次尝试
      const result = await api.submit(session.sessionId, { stepId, input }, newRequestId());
      const updated = await api.session(session.sessionId);
      set({
        session: updated,
        results: { ...get().results, [stepId]: result },
        submitted: { ...get().submitted, [stepId]: hash },
        legacy: { ...get().legacy, [stepId]: false },
        submitting: null
      });
      void get().refreshIlab();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交失败';
      // 结果不确定时先查服务端记录：若同一输入已经入库，按已提交处理，不盲目重发
      try {
        const { records } = await api.records(session.sessionId);
        const record = records.find((item) => item.stepId === stepId);
        if (record && inputHash(record.input) === hash) {
          const updated = await api.session(session.sessionId);
          set({
            session: updated,
            results: {
              ...get().results,
              [stepId]: { stepId, score: record.score, maxScore: record.maxScore, result: record.result, feedback: record.feedback, nextStepId: nextStepId(stepId) }
            },
            submitted: { ...get().submitted, [stepId]: hash },
            submitting: null
          });
          return true;
        }
      } catch {
        // 记录也取不到：保留输入，按失败处理
      }
      set({ submitting: null, submitError: { stepId, message } });
      return false;
    }
  },

  /** 约 220ms 防抖；响应到达时若输入已变化则丢弃，旧响应不会覆盖新输入的结果 */
  requestPreview: (stepId) => {
    if (!PREVIEW_STEPS.has(stepId)) return;
    const existing = previewTimers.get(stepId);
    if (existing) window.clearTimeout(existing);
    const prev = get().previews[stepId];
    set({ previews: { ...get().previews, [stepId]: { status: 'loading', chart: prev?.chart ?? null, preview: prev?.preview ?? null, image: prev?.image ?? null, forHash: prev?.forHash ?? null } } });
    const timer = window.setTimeout(() => {
      previewTimers.delete(stepId);
      const input = get().inputFor(stepId);
      const hash = inputHash(input);
      api.preview(stepId, input)
        .then((data) => {
          if (inputHash(get().inputFor(stepId)) !== hash) return;
          set({ previews: { ...get().previews, [stepId]: { status: 'ok', chart: data.chart, preview: data.preview, image: data.image, forHash: hash } } });
        })
        .catch(() => {
          if (inputHash(get().inputFor(stepId)) !== hash) return;
          const current = get().previews[stepId];
          set({ previews: { ...get().previews, [stepId]: { status: 'error', chart: current?.chart ?? null, preview: current?.preview ?? null, image: current?.image ?? null, forHash: current?.forHash ?? null } } });
        });
    }, 220);
    previewTimers.set(stepId, timer);
  },

  runReview: async (stepId) => {
    const session = get().session;
    set({ reviews: { ...get().reviews, [stepId]: { status: 'loading', data: get().reviews[stepId]?.data ?? null, error: null } } });
    try {
      const data = await api.review(stepId, get().inputFor(stepId), session?.sessionId);
      set({ reviews: { ...get().reviews, [stepId]: { status: 'ok', data, error: null } } });
    } catch (error) {
      set({ reviews: { ...get().reviews, [stepId]: { status: 'error', data: null, error: error instanceof Error ? error.message : '安全助手评审失败' } } });
    }
  },

  runReport: async () => {
    const session = get().session;
    if (!session || get().report.status === 'loading') return;
    set({ report: { status: 'loading', data: null, error: null } });
    try {
      const data = await api.report(session.sessionId);
      set({ report: { status: 'ok', data, error: null } });
    } catch (error) {
      set({ report: { status: 'error', data: null, error: error instanceof Error ? error.message : '报告生成失败' } });
    }
  },

  reset: async () => {
    const session = get().session;
    if (!session) return;
    set({ loading: true, error: null });
    try {
      const updated = await api.reset(session.sessionId);
      // 绑定实验空间的会话不清空：服务端返回一个新会话（新的记录编号）
      if (updated.sessionId !== session.sessionId) writeSessionId(updated.sessionId);
      set({ session: updated, results: {}, inputs: {}, submitted: {}, legacy: {}, previews: {}, reviews: {}, report: idle(), ilabSync: idle(), viewStepId: 'S01', loading: false });
      void get().refreshIlab();
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '重置失败' });
    }
  },

  track: (stepId, type) => {
    const { session, ilab } = get();
    if (!session || ilab?.locked) return;
    if (type === 'interact') {
      // 输入改动限频：每步 3 秒内最多报一次，不逐键/逐帧写库
      const key = `${session.sessionId}:${stepId}`;
      const now = Date.now();
      if (now - (lastInteract.get(key) ?? 0) < 3000) return;
      lastInteract.set(key, now);
    }
    api.events(session.sessionId, [{ stepId, type }]).catch(() => undefined);
  },

  refreshIlab: async () => {
    const session = get().session;
    if (!session) return;
    try {
      const status = await api.ilabStatus(session.sessionId);
      if (get().session?.sessionId === session.sessionId) set({ ilab: status });
    } catch {
      // 状态获取失败不影响实验；同步面板会显示重试
    }
  },

  bootstrapIlab: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.ilabBootstrap();
      setAuth(data.token, data.user);
      writeSessionId(data.sessionId);
      set({ token: data.token, user: data.user, page: 'experiment', legacy: {}, loading: false, session: null, inputs: {}, results: {}, submitted: {}, previews: {}, reviews: {}, report: idle(), ilab: null, ilabSync: idle() });
      return true;
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '实验空间登录失败，请重新进入' });
      return false;
    }
  },

  finalizeIlab: async () => {
    const session = get().session;
    if (!session || get().ilabSync.status === 'loading') return;
    set({ ilabSync: { status: 'loading', data: null, error: null } });
    try {
      const data = await api.ilabFinalize(session.sessionId);
      set({ ilabSync: { status: 'ok', data, error: null } });
    } catch (error) {
      set({ ilabSync: { status: 'error', data: null, error: error instanceof Error ? error.message : '提交失败' } });
    }
    await get().refreshIlab();
  },

  reconcileIlab: async () => {
    const session = get().session;
    if (!session) return;
    set({ ilabSync: { status: 'loading', data: null, error: null } });
    try {
      set({ ilabSync: { status: 'ok', data: await api.ilabReconcile(session.sessionId), error: null } });
    } catch (error) {
      set({ ilabSync: { status: 'error', data: null, error: error instanceof Error ? error.message : '对账失败' } });
    }
    await get().refreshIlab();
  },

  retryIlabAttachment: async () => {
    const session = get().session;
    if (!session) return;
    set({ ilabSync: { status: 'loading', data: null, error: null } });
    try {
      set({ ilabSync: { status: 'ok', data: await api.ilabRetryAttachment(session.sessionId), error: null } });
    } catch (error) {
      set({ ilabSync: { status: 'error', data: null, error: error instanceof Error ? error.message : '附件上传失败' } });
    }
    await get().refreshIlab();
  }
}));

/** 读取某步当前输入（未编辑时为题库默认值）；返回稳定引用，避免订阅时反复渲染 */
export function useStepInput(stepId: string): Input {
  const stored = useSessionStore((state) => state.inputs[stepId]);
  return useMemo(() => {
    if (stored) return stored;
    const step = getStep(stepId);
    return step ? defaultsFor(step) : {};
  }, [stored, stepId]);
}

/** 非 React 场景下读取输入：与 inputFor 一致 */
export function inputOf(inputs: Record<string, Input>, stepId: string): Input {
  const stored = inputs[stepId];
  if (stored) return stored;
  const step = getStep(stepId);
  return step ? defaultsFor(step) : {};
}
