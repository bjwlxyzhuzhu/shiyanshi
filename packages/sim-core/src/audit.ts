export const AUDIT_ACCOUNTS = ['student_a', 'student_b', 'svc_agent', 'admin'] as const;

export interface AuditEvent {
  time: string;
  account: string;
  action: string;
  rows: number;
}

export const AUDIT_EVENTS: AuditEvent[] = [
  { time: '01:12', account: 'admin', action: '备份数据库', rows: 0 },
  { time: '02:13', account: 'svc_agent', action: '读取 qc_records.csv', rows: 2000 },
  { time: '02:14', account: 'svc_agent', action: '调用 send_email（外部收件人）', rows: 2000 },
  { time: '03:40', account: 'svc_agent', action: '调用 send_email（外部收件人）', rows: 0 },
  { time: '09:05', account: 'student_a', action: '导出统计结果', rows: 12 },
  { time: '09:30', account: 'student_b', action: '查看实验报告', rows: 0 },
  { time: '14:22', account: 'student_a', action: '读取 qc_records.csv（脱敏版）', rows: 2000 },
  { time: '15:10', account: 'admin', action: '修改用户权限', rows: 0 }
];

export const INCIDENT = { account: 'svc_agent', window: '02:00–04:00' } as const;

export function eventsPerHour(): { hours: number[]; total: number[]; external: number[] } {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const total = hours.map((hour) => AUDIT_EVENTS.filter((event) => Number(event.time.slice(0, 2)) === hour).length);
  const external = hours.map((hour) =>
    AUDIT_EVENTS.filter((event) => Number(event.time.slice(0, 2)) === hour && event.action.includes('外部')).length
  );
  return { hours, total, external };
}

export function eventsInWindow(window: string): AuditEvent[] {
  const [start, end] = window.split('–').map((part) => Number(part.slice(0, 2)));
  return AUDIT_EVENTS.filter((event) => {
    const hour = Number(event.time.slice(0, 2));
    return start !== undefined && end !== undefined && hour >= start && hour < end;
  });
}
