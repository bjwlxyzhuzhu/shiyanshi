export type Role = 'student' | 'teacher' | 'admin';

export type StepType = 'form' | 'scene' | 'chart' | 'ai' | 'auto';

export type SceneId = 'labRoom' | 'sandbox' | 'agentConsole';

export interface User {
  id: number;
  username: string;
  role: Role;
  /** 首次登录或密码被管理员重置后为 true，须先修改密码 */
  mustChangePassword?: boolean;
}

export interface StepField {
  key: string;
  label: string;
  kind: 'number' | 'select' | 'text' | 'checklist' | 'order';
  unit?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default?: number | string;
}

export interface StepDefinition {
  id: string;
  seq: number;
  stage: string;
  name: string;
  type: StepType;
  scene?: SceneId;
  maxScore: number;
  description: string;
  material?: string;
  fields: StepField[];
}

export type StepInput = Record<string, number | string>;

export interface StepSubmit {
  stepId: string;
  input: StepInput;
}

/** 图像预览（灰度 0–255，行优先）；processed 为 null 表示图像被删除 */
export interface PreviewImage {
  width: number;
  height: number;
  original: number[];
  processed: number[] | null;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  title: string;
  x: Array<number | string>;
  series: ChartSeries[];
  threshold?: { value: number; label: string };
  /** 多条参考线（如告警/降频/关断） */
  thresholds?: Array<{ value: number; label: string }>;
  unit?: string;
}

export interface StepResult {
  stepId: string;
  score: number;
  maxScore: number;
  result: Record<string, unknown>;
  feedback: string;
  nextStepId: string | null;
}

export interface SessionState {
  sessionId: number;
  currentStepId: string;
  totalScore: number;
  finished: boolean;
  stepRecords: Array<{ stepId: string; score: number; maxScore: number }>;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AiReviewResponse {
  risks: Array<{ level: 'high' | 'mid' | 'low'; item: string; reason: string }>;
  source: 'model' | 'rule';
}

export const LIST_SEPARATOR = '|';

export function parseList(value: number | string | undefined): string[] {
  if (value === undefined || value === '') return [];
  return String(value).split(LIST_SEPARATOR).map((item) => item.trim()).filter(Boolean);
}

export function joinList(items: string[]): string {
  return items.join(LIST_SEPARATOR);
}
