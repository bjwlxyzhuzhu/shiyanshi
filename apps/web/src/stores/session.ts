import { create } from 'zustand';
import { getStep, joinList, type SessionState, type StepDefinition, type StepResult, type User } from '@zhian/shared';
import { api, getStoredUser, getToken, setAuth } from '../api';

type Input = Record<string, number | string>;

const SESSION_KEY = 'zhian.session';

let starting: Promise<void> | null = null;

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

function defaultsFor(step: StepDefinition): Input {
  const values: Input = {};
  for (const field of step.fields) {
    if (field.kind === 'order') values[field.key] = joinList(field.options ?? []);
    else values[field.key] = field.default ?? (field.kind === 'number' ? 0 : '');
  }
  return values;
}

interface SessionStore {
  token: string | null;
  user: User | null;
  session: SessionState | null;
  viewStepId: string;
  inputs: Record<string, Input>;
  results: Record<string, StepResult>;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  start: () => Promise<void>;
  startOnce: () => Promise<void>;
  view: (stepId: string) => void;
  inputFor: (stepId: string) => Input;
  setField: (stepId: string, key: string, value: number | string) => void;
  submit: (stepId: string) => Promise<void>;
  reset: () => Promise<void>;
  clearError: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  token: getToken(),
  user: getStoredUser(),
  session: null,
  viewStepId: 'S01',
  inputs: {},
  results: {},
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.login(username, password);
      setAuth(data.token, data.user);
      set({ token: data.token, user: data.user, loading: false, session: null, inputs: {}, results: {} });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '登录失败' });
    }
  },

  logout: () => {
    setAuth(null, null);
    writeSessionId(null);
    set({ token: null, user: null, session: null, inputs: {}, results: {}, error: null, viewStepId: 'S01' });
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
          for (const record of records) {
            inputs[record.stepId] = record.input;
            results[record.stepId] = {
              stepId: record.stepId,
              score: record.score,
              maxScore: record.maxScore,
              result: record.result,
              feedback: record.feedback,
              nextStepId: null
            };
          }
          set({ session: resumed, viewStepId: resumed.currentStepId, inputs, results, loading: false });
          return;
        }
      }
      const session = await api.start();
      writeSessionId(session.sessionId);
      set({ session, viewStepId: session.currentStepId, loading: false, results: {}, inputs: {} });
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法开始实验';
      if (message.includes('登录')) get().logout();
      set({ loading: false, error: message });
    }
  },

  view: (stepId) => set({ viewStepId: stepId }),

  inputFor: (stepId) => {
    const existing = get().inputs[stepId];
    if (existing) return existing;
    const step = getStep(stepId);
    return step ? defaultsFor(step) : {};
  },

  setField: (stepId, key, value) => {
    const current = get().inputFor(stepId);
    set({ inputs: { ...get().inputs, [stepId]: { ...current, [key]: value } } });
  },

  submit: async (stepId) => {
    const session = get().session;
    if (!session) return;
    set({ loading: true, error: null });
    try {
      const result = await api.submit(session.sessionId, { stepId, input: get().inputFor(stepId) });
      const updated = await api.session(session.sessionId);
      set({ session: updated, results: { ...get().results, [stepId]: result }, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '提交失败' });
    }
  },

  reset: async () => {
    const session = get().session;
    if (!session) return;
    set({ loading: true, error: null });
    try {
      const updated = await api.reset(session.sessionId);
      set({ session: updated, results: {}, inputs: {}, viewStepId: 'S01', loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '重置失败' });
    }
  }
}));
