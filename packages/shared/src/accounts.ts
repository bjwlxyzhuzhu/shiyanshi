/** 密码策略（前后端共用）：返回未满足的要求，空数组表示合格 */
export function passwordPolicyIssues(password: string, username = ''): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('至少 10 位');
  if (password.length > 64) issues.push('不超过 64 位');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) issues.push('同时包含字母和数字');
  if (username && password.toLowerCase().includes(username.toLowerCase())) issues.push('不能包含账号');
  if (/^(.)\1+$/.test(password)) issues.push('不能是同一字符重复');
  return issues;
}

/** 学生与教师分开导入，列顺序即模板顺序 */
export const STUDENT_IMPORT_COLUMNS = ['学号', '姓名', '班级', '专业'] as const;
export const TEACHER_IMPORT_COLUMNS = ['工号', '姓名', '职称', '院系'] as const;

export const STUDENT_IMPORT_TEMPLATE = [
  STUDENT_IMPORT_COLUMNS.join(','),
  '2025010101,示例学生,2025级人工智能1班,人工智能'
].join('\n');

export const TEACHER_IMPORT_TEMPLATE = [
  TEACHER_IMPORT_COLUMNS.join(','),
  'T2026001,示例教师,副教授,计算机学院'
].join('\n');

/** 学期：某学年的第一或第二学期，如“2026—2027 学年第一学期” */
export interface Term {
  startYear: number;
  termNo: 1 | 2;
}

export function termLabel(term: Term): string {
  return `${term.startYear}—${term.startYear + 1} 学年${term.termNo === 1 ? '第一' : '第二'}学期`;
}

/** 按日期推算默认学期：8 月起为新学年第一学期，2–7 月为上一学年第二学期 */
export function defaultTerm(date = new Date()): Term {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 8) return { startYear: year, termNo: 1 };
  if (month === 1) return { startYear: year - 1, termNo: 1 };
  return { startYear: year - 1, termNo: 2 };
}
