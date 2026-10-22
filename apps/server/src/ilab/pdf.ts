import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';

/**
 * 实验报告 PDF：用 pdfkit 嵌入中文字体子集，任何阅读器都能正确显示中文。
 * 字体由服务器提供（ILAB_REPORT_FONT_PATH，集合字体需同时设置 ILAB_REPORT_FONT_FAMILY）；
 * 找不到可嵌入字体时直接报错，不生成“中文显示为空白”的文件。
 */
export interface PdfLine {
  text: string;
  size?: number;
  /** 段前额外留白（pt） */
  gap?: number;
}

interface FontChoice {
  path: string;
  family?: string;
}

/** 常见可嵌入中文字体位置；生产服务器建议安装 Noto Sans CJK（SIL OFL）并显式配置 */
const CANDIDATES: FontChoice[] = [
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
  { path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
  { path: '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
  { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
  { path: 'C:/Windows/Fonts/simhei.ttf' },
  { path: 'C:/Windows/Fonts/Deng.ttf' }
];

export class ReportFontMissingError extends Error {
  constructor() {
    super('服务器上未找到可嵌入的中文字体，无法生成中文正常显示的 PDF 报告；请安装 Noto Sans CJK 并设置 ILAB_REPORT_FONT_PATH');
  }
}

export function resolveReportFont(env: NodeJS.ProcessEnv = process.env): FontChoice | null {
  if (env.ILAB_REPORT_FONT_PATH) {
    return existsSync(env.ILAB_REPORT_FONT_PATH) ? { path: env.ILAB_REPORT_FONT_PATH, family: env.ILAB_REPORT_FONT_FAMILY || undefined } : null;
  }
  return CANDIDATES.find((choice) => existsSync(choice.path)) ?? null;
}

export function buildPdf(title: string, lines: PdfLine[], font: FontChoice | null = resolveReportFont()): Promise<Buffer> {
  if (!font) return Promise.reject(new ReportFontMissingError());
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: title, Producer: 'zhian' }, compress: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      if (font.family) doc.registerFont('cjk', font.path, font.family);
      else doc.registerFont('cjk', font.path);
      doc.font('cjk');
      for (const line of lines) {
        if (line.gap) doc.moveDown(line.gap / 12);
        doc.fontSize(line.size ?? 11).text(line.text, { lineGap: 4 });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
