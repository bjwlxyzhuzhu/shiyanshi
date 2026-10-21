import type {
  AiReviewResponse,
  ChartData,
  LoginResponse,
  SessionState,
  StepResult,
  StepSubmit,
  User
} from '@zhian/shared';

export interface ProfileItem {
  key: string;
  label: string;
  score: number;
  max: number;
  percent: number;
}

const TOKEN_KEY = 'zhian.token';
const USER_KEY = 'zhian.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setAuth(token: string | null, user: User | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined)
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, { ...init, headers }).catch(() => null);
  if (!response) throw new Error('网络连接中断，请检查网络后重试。');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status >= 500 ? '服务器暂时不可用，请稍后重试，已填写的内容不会丢失。' : `请求失败（${response.status}）`;
    throw new Error((data as { message?: string }).message ?? fallback);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  me: () => request<{ user: User }>('/auth/me'),

  start: () => request<SessionState>('/experiment/start', { method: 'POST' }),

  session: (id: number) => request<SessionState>(`/experiment/${id}`),

  records: (id: number) =>
    request<{ records: Array<{ stepId: string; input: Record<string, number | string>; score: number; maxScore: number; result: Record<string, unknown>; feedback: string }> }>(
      `/experiment/${id}/records`
    ),

  submit: (sessionId: number, payload: StepSubmit) =>
    request<StepResult>(`/experiment/${sessionId}/step/${payload.stepId}`, {
      method: 'POST',
      body: JSON.stringify({ input: payload.input })
    }),

  preview: (stepId: string, input: Record<string, number | string>) =>
    request<{ chart: ChartData | null; preview: string | null }>(`/experiment/preview/${stepId}`, {
      method: 'POST',
      body: JSON.stringify({ input })
    }),

  reset: (id: number) => request<SessionState>(`/experiment/${id}/reset`, { method: 'POST' }),

  review: (stepId: string, input: Record<string, number | string>, sessionId?: number) =>
    request<AiReviewResponse>('/ai/review', {
      method: 'POST',
      body: JSON.stringify({ stepId, input, sessionId })
    }),

  report: (sessionId: number) =>
    request<{ reportId: number; contentMd: string; profile: ProfileItem[] }>('/ai/report', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    })
};
