/**
 * 生成申报书“3-6 步骤要求”表：步骤名称、目标要求、合理用时、赋分模型、满分、成绩类型均取自系统本身，
 * 避免申报材料与实际系统不一致。合理用时未经教师确认时写“待教师确认”，不填推测值。
 * 用法：pnpm --filter @zhian/server exec tsx scripts/gen-step-table.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ABILITY_LEVELS, BANK_VERSION, STEPS, knowledgeForStep } from '@zhian/shared';
import { STEP_EXPORT_META } from '../src/ilab/stepMeta.js';
import { loadExpectTimes, loadIlabConfig } from '../src/ilab/config.js';

const expect = loadExpectTimes(loadIlabConfig());
const levelOf = (stepId: string) => ABILITY_LEVELS.find((level) => level.steps.includes(stepId))?.id ?? '—';
const cell = (text: string) => text.replace(/\|/g, '／').replace(/\n/g, ' ');

const interactive = STEPS.filter((step) => STEP_EXPORT_META[step.id]?.countsAsStudentInteraction);
const lines = [
  '# 申报书 3-6 步骤要求（由系统自动生成）',
  '',
  `生成时间：${new Date().toLocaleString('zh-CN')}；题库版本：${BANK_VERSION}。请勿手工改动本表，修改系统后重新生成。`,
  '',
  `（1）学生交互性操作步骤，共 ${interactive.length} 步（S24 自动生成报告，不计入）。`,
  '',
  '| 序号 | 步骤名称 | 步骤目标要求 | 合理用时 | 目标达成度赋分模型 | 满分 | 成绩类型 | 能力层级 | 关联知识点 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...STEPS.map((step) => {
    const seconds = expect[step.id];
    const time = seconds ? `${Math.round(seconds / 60)} 分钟` : '待教师确认';
    const kinds = step.id === 'S24' ? '实验报告' : '操作成绩';
    return `| ${step.seq} | ${cell(step.name)} | ${cell(step.description)} | ${time} | ${cell(STEP_EXPORT_META[step.id]?.scoringModel ?? '')} | ${step.maxScore} | ${kinds} | ${levelOf(step.id)} | ${knowledgeForStep(step.id).map((point) => point.id).join('、')} |`;
  }),
  '',
  '另计（不计入上表 100 分）：预习成绩（10 道原理题，满分 10，系统“预习测验”）；教师评价报告（教师在后台按会话给出等级与评语）。',
  '',
  '关键安全错误（如代刷门禁、越权打开配电柜、火警先保存数据）使该步得 0 分，其他答对项不能抵消。'
];
const out = resolve(process.cwd(), '../../docs/申报书-3-6步骤表.md');
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`已生成 ${out}`);
