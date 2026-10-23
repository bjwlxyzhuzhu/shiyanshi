import type {
  AiReviewResponse,
  PrelabQuestion,
  LevelAttainment,
  ChartData,
  PreviewImage,
  LoginResponse,
  SessionState,
  StepResult,
  StepSubmit,
  User
} from '@zhian/shared';

export type StepEventType = 'open' | 'interact' | 'pause' | 'resume' | 'close' | 'hint';

export interface SeatStatus {
  admitted: boolean;
  position?: number;
  waiting: number;
  active: number;
  limit: number;
  estimatedWaitSec?: number;
}

export interface TutorAnswer {
  phase: 'pre' | 'during' | 'post';
  text: string;
  source: 'model' | 'knowledge_base';
  knowledgePoints: Array<{ id: string; name: string; course: string }>;
}

export interface ProcessSummary {
  submittedSteps: number;
  interactionSteps: number;
  totalAttempts: number;
  retriedSteps: string[];
  activeMinutes: number | null;
  wallMinutes: number | null;
  hintsUsed: number;
  tutorRequests: number;
  reviewRequests: number;
  legacySteps: number;
}

export interface ArchiveItem {
  sessionId: number;
  startedAt: string;
  finished: boolean;
  totalScore: number;
  submittedSteps: number;
  source: string;
  profile: ProfileItem[];
  ladder: LevelAttainment[];
  teacherReview: { grade: string; comment: string; updatedAt: string } | null;
}

export interface PrelabSummary {
  latest: number | null;
  best: number | null;
  attempts: number;
  total: number;
}

export interface AiAuditData {
  byScenario: Array<{ scenario: string; calls: number; received: number; failed: number; notConfigured: number; ruleFallback: number; promptTokens: number; completionTokens: number }>;
  tutor: { total: number; filtered: number; fromModel: number };
  fairness: { groups: Array<{ major: string; n: number; mean: number }>; gap: number | null; threshold: number; minGroupSize: number; flagged: boolean };
}

export interface IlabIssue {
  code: string;
  message: string;
  stepId?: string;
}

export interface IlabStatus {
  bound: boolean;
  environment?: 'mock' | 'test' | 'production';
  synthetic?: boolean;
  originId?: string | null;
  locked?: boolean;
  readiness?: {
    blockers: IlabIssue[];
    warnings: IlabIssue[];
    interactionVerified: number;
    interactionCandidates: number;
    exportTotal: number;
    rawTotal: number;
    scorePolicy: string;
    scorePolicyConfirmed: boolean;
  };
  outbox?: { state: string; attachmentState: string; attempts: number; lastErrorCode: string | null; lastErrorSummary: string | null; updatedAt: string } | null;
  report?: { id: number; size: number; createdAt: string } | null;
  budget?: { used: number; limit: number };
}

export interface IlabSyncResult {
  ok: boolean;
  state: string;
  attachmentState?: string;
  blockers?: IlabIssue[];
  warnings?: IlabIssue[];
  message: string;
}

export interface ProfileItem {
  key: string;
  label: string;
  score: number;
  max: number;
  percent: number;
}

export interface ModelSettings {
  enabled: boolean;
  preset: 'deepseek_official' | 'tokenone_relay' | 'custom';
  baseUrl: string;
  model: string;
  version: string;
  deployment: string;
  provider: string;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  effectiveSource: 'admin' | 'env' | 'none';
  keyStorage: 'env_key' | 'local_key_file';
  updatedAt: string | null;
}

export interface ModelPreset {
  id: ModelSettings['preset'];
  label: string;
  baseUrl: string | null;
  models: string[];
  provider: string;
  deployment: string;
  note: string;
}

export interface ModelTestResult {
  ok: boolean;
  state: string;
  httpStatus: number | null;
  configuredModel: string | null;
  providerModel: string | null;
  latencyMs: number;
  reply: string | null;
}

export interface ImportRow {
  line: number;
  username: string;
  name: string;
  role: string;
  className: string;
  major: string;
  status: 'create' | 'update' | 'skip' | 'error';
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  summary: { create: number; update: number; skip: number; error: number };
  rows: ImportRow[];
  credentials?: Array<{ username: string; name: string; role: string; password: string }>;
}

export interface AdminUser {
  id: number;
  username: string;
  name: string | null;
  role: 'student' | 'teacher' | 'admin';
  className: string | null;
  major: string | null;
  disabled: number;
  mustChangePassword: number;
  external: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ResultRow {
  sessionId: number;
  username: string;
  name: string;
  className: string | null;
  major: string | null;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  totalScore: number;
  stepsDone: number;
  legacySteps: number;
  prelabBest: number | null;
  teacherGrade: string | null;
  teacherComment: string | null;
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
  if (response.status === 403 && (data as { code?: string }).code === 'PASSWORD_CHANGE_REQUIRED') {
    window.dispatchEvent(new CustomEvent('zhian:password-change'));
  }
  if (response.status === 429 && (data as { code?: string }).code === 'QUEUED') {
    // 并发已满：通知界面显示排队提示
    window.dispatchEvent(new CustomEvent('zhian:queued', { detail: data }));
  }
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

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; user: User }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),

  admin: {
    model: () => request<{ settings: ModelSettings; presets: ModelPreset[] }>('/admin/model'),
    saveModel: (body: Partial<ModelSettings> & { apiKey?: string; clearApiKey?: boolean }) =>
      request<{ settings: ModelSettings }>('/admin/model', { method: 'PUT', body: JSON.stringify(body) }),
    testModel: () => request<ModelTestResult>('/admin/model/test', { method: 'POST' }),
    importUsers: (text: string, dryRun: boolean, updateExisting: boolean) =>
      request<ImportResult>('/admin/users/import', { method: 'POST', body: JSON.stringify({ text, dryRun, updateExisting }) }),
    users: (role: string, q: string) =>
      request<{ users: AdminUser[] }>(`/admin/users?role=${encodeURIComponent(role)}&q=${encodeURIComponent(q)}`),
    resetPassword: (id: number) => request<{ username: string; password: string }>(`/admin/users/${id}/reset-password`, { method: 'POST' }),
    setDisabled: (id: number, disabled: boolean) =>
      request<{ ok: boolean }>(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ disabled }) }),
    review: (sessionId: number, grade: string, comment: string) =>
      request<{ ok: boolean }>(`/admin/results/${sessionId}/review`, { method: 'PUT', body: JSON.stringify({ grade, comment }) }),
    aiAudit: () => request<AiAuditData>('/admin/ai-audit'),
    results: (className: string) =>
      request<{ bankVersion: string; totalSteps: number; classes: string[]; results: ResultRow[] }>(`/admin/results?className=${encodeURIComponent(className)}`)
  },

  start: () => request<SessionState>('/experiment/start', { method: 'POST' }),

  session: (id: number) => request<SessionState>(`/experiment/${id}`),

  records: (id: number) =>
    request<{ bankVersion: string; records: Array<{ stepId: string; input: Record<string, number | string>; score: number; maxScore: number; result: Record<string, unknown>; feedback: string; bankVersion: string }> }>(
      `/experiment/${id}/records`
    ),

  submit: (sessionId: number, payload: StepSubmit, requestId?: string) =>
    request<StepResult>(`/experiment/${sessionId}/step/${payload.stepId}`, {
      method: 'POST',
      body: JSON.stringify({ input: payload.input, requestId })
    }),

  /** 过程事件：服务器以收到时间为准，失败不影响实验操作 */
  events: (sessionId: number, events: Array<{ stepId: string; type: StepEventType }>) =>
    request<{ accepted: number }>(`/experiment/${sessionId}/events`, {
      method: 'POST',
      body: JSON.stringify({ events }),
      keepalive: true
    }),

  ilabBootstrap: () =>
    request<LoginResponse & { sessionId: number; ilab: { environment: string; synthetic: boolean } }>('/ilab/bootstrap', { method: 'POST', credentials: 'same-origin' }),

  ilabStatus: (sessionId: number) => request<IlabStatus>(`/ilab/sessions/${sessionId}/status`),

  ilabFinalize: (sessionId: number) =>
    request<IlabSyncResult>(`/ilab/sessions/${sessionId}/finalize`, { method: 'POST', body: JSON.stringify({ confirm: true }) }),

  ilabReconcile: (sessionId: number) => request<IlabSyncResult>(`/ilab/sessions/${sessionId}/reconcile`, { method: 'POST' }),

  ilabRetryAttachment: (sessionId: number) => request<IlabSyncResult>(`/ilab/sessions/${sessionId}/attachment/retry`, { method: 'POST' }),

  tutor: (phase: TutorAnswer['phase'], stepId: string, input: Record<string, number | string>, sessionId?: number) =>
    request<TutorAnswer>('/ai/tutor', { method: 'POST', body: JSON.stringify({ phase, stepId, input, sessionId }) }),

  process: (sessionId: number) => request<ProcessSummary>(`/learning/sessions/${sessionId}/process`),

  archive: () => request<{ sessions: ArchiveItem[] }>('/learning/archive'),

  prelab: () => request<{ questions: PrelabQuestion[]; summary: PrelabSummary }>('/learning/prelab'),

  submitPrelab: (answers: Record<string, number>) =>
    request<{ correct: number; total: number; results: Array<{ id: string; chosen: number; correct: boolean; answer: number; explain: string }>; summary: PrelabSummary }>(
      '/learning/prelab', { method: 'POST', body: JSON.stringify({ answers }) }
    ),

  presence: (action: 'enter' | 'heartbeat' | 'leave') =>
    request<SeatStatus>(`/presence/${action}`, { method: 'POST', keepalive: action === 'leave' }),

  ilabMockLaunchUrl: () => request<{ url: string }>('/ilab/mock/launch-url', { method: 'POST', body: JSON.stringify({}) }),

  /** 报告 PDF 需带登录凭据下载，返回 Blob */
  ilabReportBlob: async (sessionId: number): Promise<Blob> => {
    const token = getToken();
    const response = await fetch(`/api/ilab/sessions/${sessionId}/report.pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error('报告文件尚未生成');
    return response.blob();
  },

  preview: (stepId: string, input: Record<string, number | string>) =>
    request<{ chart: ChartData | null; preview: string | null; image: PreviewImage | null }>(`/experiment/preview/${stepId}`, {
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
