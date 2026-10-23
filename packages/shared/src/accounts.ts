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

/** 导入师生名单的列（顺序即模板顺序） */
export const IMPORT_COLUMNS = ['账号', '姓名', '角色', '班级', '专业'] as const;

export const IMPORT_TEMPLATE = [
  IMPORT_COLUMNS.join(','),
  '2026010101,示例学生,学生,机械2601,机械设计制造及其自动化',
  'T2026001,示例教师,教师,,'
].join('\n');
