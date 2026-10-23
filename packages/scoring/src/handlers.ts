import {
  AGENT_TOOLS,
  CONTENT_CASES,
  DATA_COLUMNS,
  INJECTION_SAMPLES,
  getStep,
  SYNTHETIC_DEVICE_PROFILE,
  parseList,
  type ChartData,
  type StepInput
} from '@zhian/shared';
import {
  INCIDENT,
  assessRisk,
  bestDesensitizeScore,
  bestImageDeid,
  bestPoisonSetting,
  checklistAccuracy,
  clamp01,
  desensitize,
  desensitizeScore,
  detectInjection,
  detectKeyLeak,
  detectPoisoning,
  evaluateFairness,
  imageDeidScore,
  eventsInWindow,
  eventsPerHour,
  orderSimilarity,
  processPortrait,
  round,
  simulateExfiltration,
  simulateGpuThermal
} from '@zhian/sim-core';

const BEST_DESENSITIZE = bestDesensitizeScore();
const BEST_IMAGE = bestImageDeid();
const BEST_IMAGE_DEID = BEST_IMAGE.score;
const BEST_POISON = bestPoisonSetting();

export interface Evaluation {
  ratio: number;
  result: Record<string, unknown>;
  feedback: string;
}

function text(input: StepInput, key: string): string {
  const value = input[key];
  return value === undefined ? '' : String(value);
}

function num(input: StepInput, key: string, fallback: number): number {
  const parsed = Number(input[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function options(stepId: string, key: string): string[] {
  return getStep(stepId)?.fields.find((field) => field.key === key)?.options ?? [];
}

/** 排序题未调整时，前端提交的是题面默认顺序。 */
function sequence(stepId: string, input: StepInput, key: string): string[] {
  const list = parseList(input[key]);
  return list.length > 0 ? list : options(stepId, key);
}

function missingAndWrong(selected: string[], correct: string[]): string {
  const missing = correct.filter((item) => !selected.includes(item));
  const wrong = selected.filter((item) => !correct.includes(item));
  const parts: string[] = [];
  if (missing.length) parts.push(`漏选：${missing.join('、')}`);
  if (wrong.length) parts.push(`误选：${wrong.join('、')}`);
  return parts.length ? parts.join('；') : '全部正确。';
}

function checklist(stepId: string, input: StepInput, key: string, correct: string[]): Evaluation {
  const selected = parseList(input[key]);
  const ratio = checklistAccuracy(selected, correct, options(stepId, key));
  return { ratio, result: { 正确率: `${Math.round(ratio * 100)}%` }, feedback: missingAndWrong(selected, correct) };
}

function ordering(stepId: string, input: StepInput, key: string, correct: string[]): Evaluation {
  const seq = sequence(stepId, input, key);
  const ratio = orderSimilarity(seq, correct);
  const firstWrong = seq.findIndex((item, index) => item !== correct[index]);
  return {
    ratio,
    result: { 顺序一致度: `${Math.round(ratio * 100)}%`, 标准顺序: correct.map((item, index) => `${index + 1}. ${item}`).join(' → ') },
    feedback: firstWrong < 0 ? '处置顺序完全正确。' : `第 ${firstWrong + 1} 步应为“${correct[firstWrong]}”。`
  };
}

/** 必要先后关系：before 必须排在 after 之前 */
interface Precedence {
  before: string;
  after: string;
  why: string;
}

/**
 * 约束式排序评分：只检查安全上必要的先后关系，不把某一种偏好顺序当作唯一答案
 * （依据：industry-lab-safety-kit-20261023，“多种合理的安全操作顺序应按前提和必要先后约束判定”）。
 */
function precedence(stepId: string, input: StepInput, key: string, rules: Precedence[]): { ratio: number; violated: Precedence[]; seq: string[] } {
  const seq = sequence(stepId, input, key);
  const violated = rules.filter((rule) => seq.indexOf(rule.before) > seq.indexOf(rule.after));
  return { ratio: rules.length ? (rules.length - violated.length) / rules.length : 1, violated, seq };
}

/** 关键安全错误：该步记 0 分并说明原因，其他答对项不能抵消 */
function withCritical(evaluation: Evaluation, critical: string[]): Evaluation {
  if (!critical.length) return evaluation;
  return {
    ratio: 0,
    result: { ...evaluation.result, 关键错误: critical.join('；') },
    feedback: `关键安全错误：${critical.join('；')}。该步不计分，其他答对项不能抵消。${evaluation.feedback}`
  };
}


/** 合并步骤：按权重汇总各部分得分；结果键冲突时加部分名前缀 */
function combine(parts: Array<[number, string, Evaluation]>): Evaluation {
  const result: Record<string, unknown> = {};
  for (const [, label, part] of parts) {
    for (const [key, value] of Object.entries(part.result)) result[key in result ? `${label}${key}` : key] = value;
  }
  return {
    ratio: parts.reduce((sum, [weight, , part]) => sum + weight * part.ratio, 0),
    result,
    feedback: parts.map(([, label, part]) => `【${label}】${part.feedback}`).join(' ')
  };
}

function authCheck(input: StepInput): Evaluation {
  const base = checklist('S07', input, 'missing', ['同意范围覆盖模型训练', '已约定数据保存期限']);
  const right = text(input, 'conclusion') === '补充授权后可用';
  return {
    ratio: base.ratio * 0.5 + (right ? 0.5 : 0),
    result: { ...base.result, 结论: text(input, 'conclusion') },
    feedback: `${base.feedback}${right ? '' : ' 原同意范围不含模型训练，应“补充授权后可用”。'}`
  };
}

function licenseCheck(input: StepInput): Evaluation {
  const license = text(input, 'license');
  const usage = text(input, 'usage');
  const truth = license === '未声明许可' ? '需进一步确认'
    : license === '研究许可（禁止商用）' && usage === '对外商业服务' ? '不合规' : '合规';
  const ratio = (license === '研究许可（禁止商用）' ? 0.3 : 0) + (usage === '课程实验' ? 0.2 : 0)
    + (text(input, 'licenseConclusion') === truth ? 0.5 : 0);
  return {
    ratio,
    result: { 按你填写的条件应得结论: truth },
    feedback: ratio >= 1 ? '许可核查准确。' : '情景为“研究许可（禁止商用）+ 课程实验”，结论应为合规；若对外商用则不合规。'
  };
}

function keyLeakCheck(input: StepInput): Evaluation {
  const outcome = detectKeyLeak(num(input, 'threshold', 400));
  const actionRight = text(input, 'action') === '立即吊销并轮换密钥';
  const chart: ChartData = {
    title: 'API 调用量（次/小时）',
    x: outcome.calls.map((_, hour) => `${hour}时`),
    series: [{ name: '调用量', values: outcome.calls }],
    threshold: { value: num(input, 'threshold', 400), label: '告警阈值' }
  };
  return {
    ratio: outcome.f1 * 0.6 + (actionRight ? 0.4 : 0),
    result: { 告警时段: outcome.flaggedHours.map((hour) => `${hour}时`).join('、') || '无', 检测F1: outcome.f1, chart },
    feedback: `${outcome.fp ? '阈值过低，白天正常调用被误报。' : outcome.fn ? '阈值过高，夜间异常未被发现。' : '告警阈值合理。'}${actionRight ? '' : ' 密钥疑似泄露时应立即吊销并轮换。'}`
  };
}

function keyScopeCheck(input: StepInput): Evaluation {
  const selected = parseList(input.scopes);
  const scopeRatio = checklistAccuracy(selected, ['模型推理', '模型微调'], options('S11', 'scopes'));
  const ttl = num(input, 'ttlDays', 365);
  const quota = num(input, 'quota', 100000);
  const ttlOk = ttl <= 30;
  const quotaOk = quota > 0 && quota <= 5000;
  return {
    ratio: scopeRatio * 0.6 + (ttlOk ? 0.2 : 0) + (quotaOk ? 0.2 : 0),
    result: { 权限正确率: `${Math.round(scopeRatio * 100)}%`, 有效期: `${ttl} 天`, 每日上限: `${quota} 次` },
    feedback: [
      missingAndWrong(selected, ['模型推理', '模型微调']),
      ttlOk ? '' : '有效期建议不超过 30 天。',
      quotaOk ? '' : '应设置每日调用上限（建议 ≤5000 次）。'
    ].filter(Boolean).join(' ')
  };
}

function injectionCheck(input: StepInput): Evaluation {
  const truth = INJECTION_SAMPLES.filter((sample) => detectInjection(sample).injected);
  const base = checklist('S12', input, 'flagged', truth);
  return {
    ratio: base.ratio,
    result: {
      ...base.result,
      verdicts: INJECTION_SAMPLES.map((sample) => detectInjection(sample))
    },
    feedback: base.feedback
  };
}

function contentPolicyCheck(input: StepInput): Evaluation {
  const truth = ['拒绝并说明', '正常回答', '拒绝并说明', '转人工并提供求助渠道'];
  const wrong = CONTENT_CASES.map((_, index) => index).filter((index) => text(input, `case${index + 1}`) !== truth[index]);
  return {
    ratio: (CONTENT_CASES.length - wrong.length) / CONTENT_CASES.length,
    result: { 处置正确: `${CONTENT_CASES.length - wrong.length}/${CONTENT_CASES.length}` },
    feedback: wrong.length ? wrong.map((index) => `“${CONTENT_CASES[index]}”应“${truth[index]}”`).join('；') : '处置策略全部正确。'
  };
}

function auditTrace(input: StepInput): Evaluation {
  const window = text(input, 'window');
  const accountRight = text(input, 'account') === INCIDENT.account;
  const windowRight = window === INCIDENT.window;
  const perHour = eventsPerHour();
  const chart: ChartData = {
    title: '审计事件分布（次/小时）',
    x: perHour.hours.map((hour) => `${hour}时`),
    series: [
      { name: '全部事件', values: perHour.total },
      { name: '外部发送', values: perHour.external }
    ]
  };
  return {
    ratio: (accountRight ? 0.7 : 0) + (windowRight ? 0.3 : 0),
    result: {
      时间窗内事件: eventsInWindow(window).map((event) => `${event.time} ${event.account} ${event.action}`).join('；') || '无',
      chart
    },
    feedback: accountRight && windowRight ? '追溯准确：svc_agent 在 02:00–04:00 外发了企业质检数据。' : '请查看“外部发送”出现的时段，并定位对应账号。'
  };
}

function reportCheck(input: StepInput): Evaluation {
  const base = checklist('S22', input, 'elements', ['事件时间线', '影响的数据类型与规模', '已采取的处置措施', '根因分析', '整改措施与责任人']);
  const right = text(input, 'severity') === '较大';
  return {
    ratio: base.ratio * 0.7 + (right ? 0.3 : 0),
    result: { ...base.result, 事件等级: text(input, 'severity') },
    feedback: `${base.feedback}${right ? '' : ' 2000 条含个人信息记录外泄，应定为“较大”事件。'}`
  };
}

const HANDLERS: Record<string, (input: StepInput) => Evaluation> = {
  S01: (input) => {
    const correct = ['安全培训合格证明', '实验任务书', '指导教师签字', '数据使用承诺书', '机房区域与时段准入授权'];
    const base = checklist('S01', input, 'materials', correct);
    const critical = parseList(input.materials).includes('同学代刷门禁记录') ? ['把代刷门禁当作准入依据（身份与区域授权必须本人核验）'] : [];
    return withCritical(base, critical);
  },

  S02: (input) => {
    const scenario = { dataLevel: '含个人信息', modelScale: '中模型(1–10B)', toolUse: '可写/可外发工具' };
    const chosen = assessRisk(text(input, 'dataLevel'), text(input, 'modelScale'), text(input, 'toolUse'));
    const truth = assessRisk(scenario.dataLevel, scenario.modelScale, scenario.toolUse);
    const dims = (['dataLevel', 'modelScale', 'toolUse'] as const).filter((key) => text(input, key) === scenario[key]).length;
    const levelRight = text(input, 'riskLevel') === truth.level;
    const ratio = (dims / 3) * 0.6 + (levelRight ? 0.4 : 0);
    return {
      ratio,
      result: { 按你的判断推算等级: chosen.level, 情景实际等级: truth.level, 维度判断正确: `${dims}/3` },
      feedback: levelRight && dims === 3 ? '风险研判准确。' : `情景应判为：含个人信息 / 中模型 / 可写可外发工具，综合等级“${truth.level}”。`
    };
  },

  S03: (input) => checklist('S03', input, 'plans', [
    '数据泄露应急预案', '服务器过温与供电异常处置预案', '火灾报警与疏散预案（含集合点）', '液冷漏液处置预案', '有害内容输出处置预案', '智能体越权处置预案', '应急联系人与上报路径'
  ]),

  S04: (input) => {
    const correct = ['核对接地合格记录与标识，缺记录则报告', '只读查看 UPS/PDU 告警指示', '检查进出风无遮挡、盲板与机箱盖在位', '确认安全出口、报警点与集合点位置', '确认疏散与检修通道畅通'];
    const base = checklist('S04', input, 'checks', correct);
    const selected = parseList(input.checks);
    // 设备档案中的进风测点读数与允许范围（不是统一的“合规温度”）
    const reading = 29.5;
    const [low, high] = SYNTHETIC_DEVICE_PROFILE.inletRangeC!;
    const expected = reading < low || reading > high ? '超出档案允许范围，报告值班运维' : '在档案允许范围内，可继续';
    const recorded = num(input, 'inletC', 22);
    const recordOk = Math.abs(recorded - reading) <= 0.5;
    const verdict = text(input, 'inletVerdict');
    const verdictOk = verdict === expected;
    const critical: string[] = [];
    if (selected.includes('打开配电柜检查接线端子')) critical.push('学生打开配电柜属于越权设施操作');
    if (selected.includes('拆下机箱盖以改善散热')) critical.push('拆盖运行会破坏风道与防护');
    return withCritical({
      ratio: base.ratio * 0.6 + (recordOk ? 0.15 : 0) + (verdictOk ? 0.25 : 0),
      result: { ...base.result, 记录读数: `${recorded} °C`, 测点实际读数: `${reading} °C`, 档案允许范围: `${low}–${high} °C`, 判断: verdictOk ? '正确' : `应为“${expected}”` },
      feedback: `${base.feedback}${recordOk ? '' : ' 记录的读数与测点不一致，巡检应如实记录。'}${verdictOk ? '' : ' 进风温度要对照设备档案判断，超出范围应报告而不是继续。'}`
    }, critical);
  },

  S05: (input) => {
    const truth: Record<string, string> = {
      工号: '个人信息', 姓名: '个人信息', 手机号: '个人信息', 身份证号: '敏感个人信息',
      班组: '一般数据', 缺陷检测结果: '一般数据', 职业健康体检结论: '敏感个人信息'
    };
    const wrong = DATA_COLUMNS.filter((column) => text(input, `col_${column}`) !== truth[column]);
    const ratio = (DATA_COLUMNS.length - wrong.length) / DATA_COLUMNS.length;
    return {
      ratio,
      result: { 分级正确: `${DATA_COLUMNS.length - wrong.length}/${DATA_COLUMNS.length}` },
      feedback: wrong.length ? `需修正：${wrong.map((column) => `${column}→${truth[column]}`).join('、')}` : '分类分级全部正确。'
    };
  },

  S06: (input) => {
    const outcome = desensitize({
      name: text(input, 'name'), phone: text(input, 'phone'), idCard: text(input, 'idCard'), health: text(input, 'health')
    });
    const textRatio = desensitizeScore(outcome) / BEST_DESENSITIZE;
    // 图像部分：人脸去标识化（数字图像处理），按全部选项与强度的最优解归一化
    const image = processPortrait(text(input, 'photo') || '保留原图', num(input, 'strength', 1));
    const imageRatio = imageDeidScore(image) / BEST_IMAGE_DEID;
    const ratio = clamp01(0.7 * textRatio + 0.3 * imageRatio);
    const imageFeedback = image.processed === null
      ? '删除整张图像虽然保护了隐私，但护目镜信息也随之丢失，训练任务无法进行。'
      : image.identifiability > 0.2
        ? '人脸区域仍残留较多高频细节（五官边缘），身份可能被识别，需要更强的低通处理。'
        : image.taskUtility < 0.5
          ? '人脸已难以识别，但护目镜等任务信息被一并抹去，可降低处理强度或改用低通滤波。'
          : '图像去除了身份细节，同时保留了护目镜这一低频任务信息。';
    const textFeedback = outcome.residualHits.length
      ? '文本脱敏后仍能被自动识别出个人标识，需加强处理。'
      : outcome.utility < 0.8 ? '文本隐私风险已控制，但删除过多信息影响后续分析，可考虑泛化。' : '文本在隐私保护与数据可用性之间取得了较好平衡。';
    return {
      ratio,
      result: {
        preview: outcome.masked,
        image: { width: image.width, height: image.height, original: image.original, processed: image.processed },
        脱敏后样例: outcome.masked,
        残留可识别标识: outcome.residualHits.length ? outcome.residualHits.map((hit) => hit.type).join('、') : '无',
        隐私风险指数: outcome.riskIndex,
        数据可用性: outcome.utility,
        人脸高频细节残留: image.identifiability,
        护目镜信息保留: image.taskUtility
      },
      feedback: `${textFeedback}${imageFeedback}`
    };
  },


  S07: (input) => combine([[0.6, '数据授权', authCheck(input)], [0.4, '模型许可', licenseCheck(input)]]),

  S08: (input) => {
    const outcome = detectPoisoning(text(input, 'method'), num(input, 'threshold', 1.5));
    const chart: ChartData = {
      title: '样本离群度（前 60 名，降序）',
      x: outcome.sortedScores.map((_, index) => index + 1),
      series: [{ name: '离群度 z', values: outcome.sortedScores }],
      threshold: { value: num(input, 'threshold', 1.5), label: '阈值' }
    };
    return {
      ratio: outcome.f1 / BEST_POISON.f1,
      result: { 标记样本数: outcome.flagged, 命中投毒: outcome.tp, 误报: outcome.fp, 漏检: outcome.fn, 精确率: outcome.precision, 召回率: outcome.recall, F1: outcome.f1, 本数据集可达最优F1: BEST_POISON.f1, chart },
      feedback: text(input, 'method') === '仅看标签分布'
        ? '标签分布无法定位单条投毒样本，请改用基于特征的方法。'
        : outcome.fp >= 3 ? `误报 ${outcome.fp} 条，可适当提高阈值。`
          : outcome.fn >= 2 ? `漏检 ${outcome.fn} 条，可降低阈值或叠加触发词扫描。`
            : '检测效果良好，接近本数据集的最优水平。'
    };
  },

  S09: (input) => {
    const base = checklist('S09', input, 'locations', ['训练机本地缓存', '对象存储备份', '实验日志中的样本片段', '向量数据库索引', '个人电脑下载副本']);
    const ssd = text(input, 'ssdMethod') === '使用设备支持的加密擦除/安全清除并验证';
    const cloud = text(input, 'cloudMethod') === '按保留策略删除，并确认历史版本与快照同步清除';
    const disk = text(input, 'diskMethod') === '消磁或物理销毁，登记资产去向';
    const notes: string[] = [];
    if (!ssd) notes.push('固态盘有磨损均衡与预留空间，多次覆写不能保证清除，消磁对固态盘无效，应使用设备支持的安全清除并验证');
    if (!cloud) notes.push('对象存储的历史版本与快照仍保留数据，应按保留策略一并处理');
    if (!disk) notes.push('报废机械硬盘出场前应消磁或物理销毁并登记去向，快速格式化可被恢复');
    return {
      ratio: base.ratio * 0.4 + (ssd ? 0.2 : 0) + (cloud ? 0.2 : 0) + (disk ? 0.2 : 0),
      result: { ...base.result, 固态盘: text(input, 'ssdMethod'), 对象存储: text(input, 'cloudMethod'), 机械硬盘: text(input, 'diskMethod') },
      feedback: `${base.feedback}${notes.length ? ` ${notes.join('；')}。` : ' 清除方式与介质类型匹配。'}`
    };
  },

  S10: (input) => ordering('S10', input, 'sequence', [
    '立即隔离受影响系统', '评估泄露范围与数据类型', '向实验室负责人与学校网信部门报告',
    '通知受影响的个人', '修复漏洞并轮换凭据', '复盘并落实整改'
  ]),






  S11: (input) => combine([[0.4, '密钥权限', keyScopeCheck(input)], [0.6, '泄露检测', keyLeakCheck(input)]]),

  S12: (input) => combine([[0.55, '提示注入', injectionCheck(input)], [0.45, '内容处置', contentPolicyCheck(input)]]),

  S13: (input) => {
    const levels = Object.fromEntries(AGENT_TOOLS.map((tool) => [tool, text(input, `tool_${tool}`)]));
    const attack = simulateExfiltration(levels);
    const ratio = (attack.compliantTools / AGENT_TOOLS.length) * 0.6 + (attack.blocked ? 0.4 : 0);
    const facility = levels['机房电源与制冷控制'] ?? '';
    const critical = facility && facility !== '禁止' ? ['智能体被授予机房电源与制冷控制权限（设施高危操作不得交给智能体）'] : [];
    return withCritical({
      ratio,
      result: { 攻击结果: attack.blocked ? '外发被拦截' : '数据被外发', 合规工具数: `${attack.compliantTools}/${AGENT_TOOLS.length}`, trace: attack.trace },
      feedback: attack.blocked
        ? attack.compliantTools === AGENT_TOOLS.length ? '最小权限配置正确，攻击被拦截。' : '攻击被拦截，但部分工具权限仍偏宽或偏严。'
        : '攻击成功：至少一条外发通道处于“自动允许”。'
    }, critical);
  },

  S14: (input) => {
    const threshold = num(input, 'threshold', 0.3);
    const outcome = evaluateFairness(text(input, 'metric'), threshold);
    const thresholdOk = threshold >= 0.05 && threshold <= 0.1;
    const consistent = (text(input, 'conclusion') === '不通过，需整改') === outcome.exceeds;
    const correct = text(input, 'conclusion') === '不通过，需整改';
    const chart: ChartData = {
      title: '两组指标对比',
      x: ['预测为正比例', '真正例率'],
      series: [
        { name: '城镇', values: [0.42, 0.86] },
        { name: '农村', values: [0.29, 0.71] }
      ]
    };
    return {
      ratio: (thresholdOk ? 0.3 : 0) + (consistent ? 0.3 : 0) + (correct ? 0.4 : 0),
      result: { 人口统计均等差: outcome.demographicParityDiff, 机会均等差: outcome.equalOpportunityDiff, 是否超出你的阈值: outcome.exceeds ? '是' : '否', chart },
      feedback: thresholdOk ? (correct ? '评估结论正确，需对农村组样本进行再平衡。' : '两项差异均大于 0.1，应判定不通过。') : '阈值过宽，常用可接受范围为 0.05–0.1。'
    };
  },

  S15: (input) => {
    const order = precedence('S15', input, 'sequence', [
      { before: '确认任务许可与使用时段', after: '提交逻辑启动（作业调度）', why: '没有任务许可不能启动' },
      { before: '核对获批的功率与制冷预算', after: '提交逻辑启动（作业调度）', why: '有插座不等于可以满载，须先核对预算' },
      { before: '在 BMC 中只读查看电源、风扇、温度告警', after: '提交逻辑启动（作业调度）', why: '告警未解释前不启动高负载' },
      { before: '确认进风温度在设备档案范围内', after: '提交逻辑启动（作业调度）', why: '环境条件须在启动前确认' },
      { before: '提交逻辑启动（作业调度）', after: '启动后观察温度与功耗', why: '启动后需持续观察' }
    ]);
    const roles = checklist('S15', input, 'facilityOnly', ['合上配电柜总开关', '闭合机柜 PDU 断路器', 'UPS 维护与电池更换']);
    const selected = parseList(input.facilityOnly);
    const critical = selected.includes('合上配电柜总开关') ? [] : ['把合配电柜总开关当作学生可做的操作（属于授权专业人员的设施作业）'];
    return withCritical({
      ratio: order.ratio * 0.6 + roles.ratio * 0.4,
      result: { 必要先后关系: `${order.ratio === 1 ? '全部满足' : `违反 ${order.violated.length} 条`}`, 角色区分正确率: roles.result.正确率 },
      feedback: `${order.violated.length ? `顺序问题：${order.violated.map((rule) => rule.why).join('；')}。` : '启动前核验顺序满足全部必要前提。'}${roles.feedback === '全部正确。' ? '' : ` 角色区分：${roles.feedback}`}`
    }, critical);
  },

  S16: (input) => {
    const profile = SYNTHETIC_DEVICE_PROFILE;
    const t = profile.gpuThresholds;
    const load = num(input, 'loadPct', 90);
    const metric = text(input, 'metric');
    const outcome = simulateGpuThermal(load, num(input, 'fanPct', 30), num(input, 'ambientC', 26));
    const chart: ChartData = {
      title: 'GPU 核心温度曲线（教学热路模型）',
      x: outcome.timeS,
      series: [{ name: 'GPU 核心温度', values: outcome.tempC }],
      threshold: { value: t.warningC!, label: `告警 ${t.warningC} °C` },
      thresholds: [
        { value: t.warningC!, label: `告警 ${t.warningC} °C` },
        { value: t.slowdownC!, label: `降频 ${t.slowdownC} °C` },
        { value: t.shutdownC!, label: `关断 ${t.shutdownC} °C` }
      ],
      unit: '°C'
    };
    const metricOk = metric === profile.gpuMetric;
    const level = outcome.peakC >= t.shutdownC! ? '达到关断阈值' : outcome.peakC >= t.slowdownC! ? '达到降频阈值' : outcome.peakC >= t.warningC! ? '超过告警阈值' : '低于告警阈值';
    const safe = outcome.peakC < t.warningC!;
    const meetsTask = load >= 85;
    // 安全先行：超过告警阈值时只计测点选择分，负载再高也不加分
    const ratio = (metricOk ? 0.2 : 0) + (safe ? 0.6 + (meetsTask ? 0.2 : 0) : 0);
    const metricNote = metricOk ? '' : profile.unavailableSensors.includes(metric)
      ? ` 设备档案未提供“${metric}”，应记为未知，不能套用核心温度阈值。`
      : ` 阈值对应的测点是“${profile.gpuMetric}”，进风温度与芯片温度不能混用。`;
    return {
      ratio,
      result: { 研判测点: metric, 峰值温度: `${outcome.peakC} °C`, 温度状态: level, 稳态温度: `${outcome.steadyC} °C`, 功耗: `${outcome.powerW} W`, 任务负载要求: meetsTask ? '满足' : '未满足（要求 ≥ 85%）', 设备档案: profile.label, chart },
      feedback: `${safe ? meetsTask ? '温度低于告警阈值且满足任务负载要求。' : '温度安全，但负载未达到任务要求。' : `峰值${level}（${outcome.peakC} °C），应先降低温度；超限时负载再高也不能弥补。`}${metricNote}`
    };
  },

  S17: (input) => {
    const order = precedence('S17', input, 'sequence', [
      { before: '通知受影响的实验人员并停止相关任务', after: '按程序关闭服务器', why: '关机前先通知相关人员' },
      { before: '按程序关闭服务器', after: '断开 A、B 两路供电输入', why: '先关机再断开供电' },
      { before: '断开 A、B 两路供电输入', after: '在断开点挂牌上锁（每位维修人员一把锁）', why: '断开后在断开点挂牌上锁' },
      { before: '在断开点挂牌上锁（每位维修人员一把锁）', after: '验电确认无电后开始维修', why: '挂牌上锁后验电，再开始维修' },
      { before: '验电确认无电后开始维修', after: '维修完成后由上锁人本人解锁摘牌并恢复供电', why: '恢复供电放在最后' }
    ]);
    const standbyOk = text(input, 'standby') === '不可以，须确认所有供电输入已断开并验电';
    const duties = checklist('S17', input, 'duties', ['核对两路供电都已断开并挂牌', '提醒他人不得擅自送电', '记录挂牌上锁与解除的时间']);
    const selected = parseList(input.duties);
    const critical: string[] = [];
    if (selected.includes('维修人员暂时离开时代为解锁送电')) critical.push('他人代为解锁送电会使维修人员触电');
    if (selected.includes('亲自断开 PDU 断路器')) critical.push('学生不得操作配电设备');
    return withCritical({
      ratio: order.ratio * 0.5 + (standbyOk ? 0.2 : 0) + duties.ratio * 0.3,
      result: { 必要先后: order.violated.length ? `违反 ${order.violated.length} 条` : '全部满足', 待机判断: standbyOk ? '正确' : '错误', 职责: duties.result.正确率 },
      feedback: `${order.violated.length ? `${[...new Set(order.violated.map((rule) => rule.why))].join('；')}。` : '挂牌上锁流程满足全部必要先后。'}${standbyOk ? '' : ' 待机不等于断电，双电源服务器须断开所有输入并验电。'}${duties.feedback === '全部正确。' ? '' : ` 职责：${duties.feedback}`}`
    }, critical);
  },

  S18: (input) => {
    const overheat = precedence('S18', input, 'overheat', [
      { before: '立即向值班运维报告', after: '在安全时间窗内保存检查点', why: '报告不应等到最后，应先报告' },
      { before: '立即向值班运维报告', after: '温度仍上升则受控关机', why: '受控关机前应已报告值班' },
      { before: '停止提交新任务并降低负载', after: '温度仍上升则受控关机', why: '先降负载，仍上升再关机' },
      { before: '在安全时间窗内保存检查点', after: '温度仍上升则受控关机', why: '关机前在安全时间窗内保存' },
      { before: '检查风扇与空调告警', after: '记录事件并复盘', why: '复盘放在处置之后' },
      { before: '温度仍上升则受控关机', after: '记录事件并复盘', why: '复盘放在处置之后' }
    ]);
    const fire = text(input, 'fire');
    const critical: string[] = [];
    if (fire !== '按下报警按钮并沿疏散路线撤离到集合点') critical.push(`火警时“${fire}”会延误报警与撤离`);
    if (overheat.seq[overheat.seq.length - 1] === '立即向值班运维报告') critical.push('无烟过温时把报告放在最后');
    return withCritical({
      ratio: overheat.ratio * 0.65 + 0.35,
      result: { 无烟过温必要先后: overheat.violated.length ? `违反 ${overheat.violated.length} 条` : '全部满足', 火警: fire },
      feedback: overheat.violated.length ? `无烟过温：${[...new Set(overheat.violated.map((rule) => rule.why))].join('；')}。` : '无烟过温处置满足全部必要先后。'
    }, critical);
  },

  S19: (input) => {
    const order = precedence('S19', input, 'sequence', [
      { before: '立即远离漏液区域并设置警戒，提醒他人不要踩踏', after: '由授权运维按设备程序隔离供电与冷却回路', why: '先远离并警戒，人员安全优先' },
      { before: '立即报告值班运维，说明机柜编号与现象', after: '由授权运维按设备程序隔离供电与冷却回路', why: '隔离由运维执行，须先报告' },
      { before: '立即报告值班运维，说明机柜编号与现象', after: '在值班运维指导下停止提交新任务', why: '先报告，再按指导调整任务' },
      { before: '由授权运维按设备程序隔离供电与冷却回路', after: '记录告警时间与现象，配合复盘', why: '记录复盘放在处置之后' }
    ]);
    const forbidden = checklist('S19', input, 'forbidden', ['用手或纸巾擦拭机柜附近的液体', '自行拔下机柜电源插头', '站在液体中操作键盘保存模型', '打开机柜门查找漏点']);
    const critical = order.seq[0] !== '立即远离漏液区域并设置警戒，提醒他人不要踩踏' && order.seq[0] !== '立即报告值班运维，说明机柜编号与现象'
      ? [`漏液时第一步“${order.seq[0]}”延误了远离与报告`] : [];
    return withCritical({
      ratio: order.ratio * 0.5 + forbidden.ratio * 0.5,
      result: { 必要先后: order.violated.length ? `违反 ${order.violated.length} 条` : '全部满足', 禁止行为识别: forbidden.result.正确率 },
      feedback: `${order.violated.length ? `${[...new Set(order.violated.map((rule) => rule.why))].join('；')}。` : '处置顺序满足全部必要先后。'}${forbidden.feedback === '全部正确。' ? '' : ` 禁止行为：${forbidden.feedback}`}`
    }, critical);
  },

  S20: (input) => {
    const order = precedence('S20', input, 'sequence', [
      { before: '听到声光报警立即停止操作', after: '沿疏散路线撤离防护区', why: '听到报警先停止操作' },
      { before: '沿疏散路线撤离防护区', after: '在集合点清点人数并报告', why: '先撤离再清点' },
      { before: '确认防护区门已关闭，不阻挡防护门', after: '在集合点清点人数并报告', why: '撤离时随手确认防护门关闭' },
      { before: '在集合点清点人数并报告', after: '等待专业人员通风检测确认后再返回', why: '返回必须放在最后' }
    ]);
    const falseAlarm = text(input, 'falseAlarm');
    const reentry = text(input, 'reentry');
    const falseOk = falseAlarm === '由授权人员按程序使用紧急停止装置并报告';
    const reentryOk = reentry === '专业人员完成通风与检测并确认后';
    const critical: string[] = [];
    if (falseAlarm === '用物品顶住防护门，方便进出查看') critical.push('顶住防护门会使灭火剂失效并让人员暴露');
    if (falseAlarm === '自己返回防护区关闭报警器') critical.push('延时阶段返回防护区有窒息风险');
    if (!reentryOk) critical.push(`喷放后“${reentry}”有窒息风险`);
    return withCritical({
      ratio: order.ratio * 0.5 + (falseOk ? 0.25 : 0) + (reentryOk ? 0.25 : 0),
      result: { 必要先后: order.violated.length ? `违反 ${order.violated.length} 条` : '全部满足', 误报处理: falseAlarm, 再次进入: reentry },
      feedback: order.violated.length ? `${[...new Set(order.violated.map((rule) => rule.why))].join('；')}。` : '撤离与确认顺序满足全部必要先后。'
    }, critical);
  },

  S21: (input) => {
    const first = text(input, 'first');
    const order = precedence('S21', input, 'sequence', [
      { before: '按急停断电或用干燥绝缘物使其脱离电源', after: '确认脱离电源后检查意识与呼吸', why: '先使其脱离电源，再接触检查' },
      { before: '确认脱离电源后检查意识与呼吸', after: '无呼吸时由受过培训的人员进行心肺复苏并使用 AED', why: '先判断意识与呼吸，再决定是否心肺复苏' },
      { before: '按急停断电或用干燥绝缘物使其脱离电源', after: '拨打 120 并报告实验室负责人', why: '先断电，避免施救者与伤者持续受害' },
      { before: '拨打 120 并报告实验室负责人', after: '保护现场并记录事件经过', why: '记录放在救治与报告之后' }
    ]);
    const firstOk = first === '先确保自身安全，再按急停断电或用干燥绝缘物使其脱离电源';
    const critical = first === '立刻用手把他拉开' ? ['徒手拉触电者会使施救者同样触电'] : [];
    return withCritical({
      ratio: (firstOk ? 0.4 : 0) + order.ratio * 0.6,
      result: { 第一反应: first, 必要先后: order.violated.length ? `违反 ${order.violated.length} 条` : '全部满足' },
      feedback: `${firstOk ? '' : '第一反应应是先保证自身安全并断电。'}${order.violated.length ? `${[...new Set(order.violated.map((rule) => rule.why))].join('；')}。` : '施救与报告顺序满足全部必要先后。'}`
    }, critical);
  },



  S22: (input) => combine([[0.45, '审计追溯', auditTrace(input)], [0.55, '事件报告', reportCheck(input)]]),

  S23: (input) => checklist('S23', input, 'actions', [
    '启用敏感数据脱敏网关', '智能体外发工具改为人工确认', '密钥按月轮换并设调用上限', '机房增加温度联动告警'
  ]),

  S24: () => ({ ratio: 1, result: {}, feedback: '已生成实验报告与能力画像。' })
};

export function evaluateStep(stepId: string, input: StepInput): Evaluation {
  const handler = HANDLERS[stepId];
  if (!handler) return { ratio: 0, result: {}, feedback: '未知步骤。' };
  const outcome = handler(input);
  return { ...outcome, ratio: round(clamp01(outcome.ratio), 3) };
}

export function hasHandler(stepId: string): boolean {
  return stepId in HANDLERS;
}
