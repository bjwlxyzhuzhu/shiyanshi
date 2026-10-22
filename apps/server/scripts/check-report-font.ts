/**
 * 部署自检：用服务器上的中文字体生成一份样例 PDF，确认报告中文可正常显示。
 * 用法：pnpm --filter @zhian/server exec tsx scripts/check-report-font.ts [输出路径]
 */
import { writeFileSync } from 'node:fs';
import { buildPdf, resolveReportFont } from '../src/ilab/pdf.js';

const font = resolveReportFont();
console.log(`[font] ${font ? `${font.path}${font.family ? ` (${font.family})` : ''}` : '未找到可嵌入的中文字体'}`);
const bytes = await buildPdf('智安工坊报告字体自检', [
  { text: '智安工坊 · 报告字体自检', size: 20 },
  { text: '人工智能实验安全风险识别与应急处置虚拟仿真实验', size: 12, gap: 4 },
  { text: 'S01 实验室准入与身份核验｜得分 2.3/4｜提交 1 次｜用时 35 秒｜证据 observed_interaction' },
  { text: '中文、English、数字 0123、标点（，。；：）混排测试。' }
]);
const out = process.argv[2] ?? 'report-font-check.pdf';
writeFileSync(out, bytes);
console.log(`[ok] ${out} ${bytes.length} bytes`);
