import { useMemo } from 'react';
import { create } from 'zustand';
import {
  getStep,
  joinList,
  nextStepId,
  type AiReviewResponse,
  type ChartData,
  type SessionState,
  type StepDefinition,
  type StepResult,
  type User
} from '@zhian/shared';
import { api, getStoredUser, getToken, setAuth, type ProfileItem } from '../api';

type Input = Record<string, number | string>;

const SESSION_KEY = 'zhian.session';

/** 支持实时预览的步骤：只取后端 chart / preview，不含分数 */
export const PREVIEW_STEPS = new Set(['S06', 'S08', 'S13', 'S17', 'S19', 'S21']);

let starting: Promise<void> | null = null;
const previewTimers = new Map<string, number>();

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
  session: SessionState | null;
  viewStepId: string;
  inputs: Record<string, Input>;
  results: Record<string, StepResult>;
  /** 每步最近一次正式提交的输入指纹 */
  submitted: Record<string, string>;
  previews: Record<string, PreviewState>;
  reviews: Record<string, AsyncState<AiReviewResponse>>;
  report: AsyncState<{ reportId: number; contentMd: string; profile: ProfileItem[] }>;
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
}

const idle = <T,>(): AsyncState<T> => ({ status: 'idle', data: null, error: null });

export const useSessionStore = create<SessionStore>((set, get) => ({
  token: getToken(),
  user: getStoredUser(),
  session: null,
  viewStepId: 'S01',
  inputs: {},
  results: {},
  submitted: {},
  previews: {},
  reviews: {},
  report: idle(),
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
      set({ token: data.token, user: data.user, loading: false, session: null, inputs: {}, results: {}, submitted: {}, previews: {}, reviews: {}, report: idle() });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '登录失败' });
    }
  },

  logout: () => {
    setAuth(null, null);
    writeSessionId(null);
    set({ token: null, user: null, session: null, inputs: {}, results: {}, submitted: {}, previews: {}, reviews: {}, report: idle(), error: null, submitError: null, viewStepId: 'S01' });
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
          for (const record of records) {
            inputs[record.stepId] = record.input;
            submitted[record.stepId] = inputHash(record.input);
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
          set({ session: resumed, viewStepId: resumed.currentStepId, inputs, results, submitted, loading: false });
          return;
        }
      }
      const session = await api.start();
      writeSessionId(session.sessionId);
      set({ session, viewStepId: session.currentStepId, loading: false, results: {}, inputs: {}, submitted: {}, previews: {}, reviews: {}, report: idle() });
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
    const { session, results } = get();
    if (!session) return false;
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
      const result = await api.submit(session.sessionId, { stepId, input });
      const updated = await api.session(session.sessionId);
      set({
        session: updated,
        results: { ...get().results, [stepId]: result },
        submitted: { ...get().submitted, [stepId]: hash },
        submitting: null
      });
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
    set({ previews: { ...get().previews, [stepId]: { status: 'loading', chart: prev?.chart ?? null, preview: prev?.preview ?? null, forHash: prev?.forHash ?? null } } });
    const timer = window.setTimeout(() => {
      previewTimers.delete(stepId);
      const input = get().inputFor(stepId);
      const hash = inputHash(input);
      api.preview(stepId, input)
        .then((data) => {
          if (inputHash(get().inputFor(stepId)) !== hash) return;
          set({ previews: { ...get().previews, [stepId]: { status: 'ok', chart: data.chart, preview: data.preview, forHash: hash } } });
        })
        .catch(() => {
          if (inputHash(get().inputFor(stepId)) !== hash) return;
          const current = get().previews[stepId];
          set({ previews: { ...get().previews, [stepId]: { status: 'error', chart: current?.chart ?? null, preview: current?.preview ?? null, forHash: current?.forHash ?? null } } });
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
      set({ session: updated, results: {}, inputs: {}, submitted: {}, previews: {}, reviews: {}, report: idle(), viewStepId: 'S01', loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '重置失败' });
    }
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
