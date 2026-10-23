/**
 * 多课程融合与阶梯式能力标准。
 * 知识点同时作为“AI 实验导师”的知识库：只写原理与方法，不写各步骤的标准答案。
 */
export interface Course {
  id: 'AI' | 'DIP' | 'NET' | 'MATH' | 'SAFE';
  name: string;
  teacher: string;
}

export const COURSES: Course[] = [
  { id: 'AI', name: '人工智能概论', teacher: '朱丽叶' },
  { id: 'MATH', name: '数学建模', teacher: '李亚峰' },
  { id: 'SAFE', name: '实验室安全', teacher: '张雪亚' },
  { id: 'DIP', name: '数字图像处理', teacher: '樊攀' },
  { id: 'NET', name: '计算机网络', teacher: '陈冬' }
];

export interface KnowledgePoint {
  id: string;
  name: string;
  course: Course['id'];
  steps: string[];
  /** 原理说明（知识库正文），不含答案 */
  principle: string;
  /** 依据的规范或标准名称（如有） */
  reference?: string;
}

export const KNOWLEDGE_POINTS: KnowledgePoint[] = [
  { id: 'K01', name: '实验室准入与区域授权', course: 'SAFE', steps: ['S01'], principle: '进入实验室开展有风险的实验前，应完成安全培训考核并取得授权；机房还要核对本人身份、访问时段与授权区域，准入凭证不能由他人代办。与实验风险无关的材料不应作为准入条件。', reference: '《高等学校实验室安全规范》（教育部，2023）；Equinix Global IBX Policies（2026）' },
  { id: 'K02', name: '风险辨识与分级管控', course: 'SAFE', steps: ['S02'], principle: '风险等级由危害对象的敏感程度、系统能力规模和可能的影响途径综合决定；当存在敏感数据且系统具备向外部发送数据的能力时，风险会显著放大，应提高管控等级。', reference: '《高等学校实验室安全规范》（教育部，2023）' },
  { id: 'K03', name: '分情景应急预案', course: 'SAFE', steps: ['S03', 'S10', 'S20'], principle: '不同事故的处置逻辑不同：火情与人身风险以报警、撤离和清点为先；漏液以远离液体与电气暴露区域并通知值班为先；无危险的过温以尽早报告、减载和受控处置为主。安排顺序时自问：哪一步最快保护人身安全？哪一步依赖前一步的信息？', reference: 'Equinix IBX Health and Safety Guide；华为 FusionModule2000 安装指南（2026）；Dell iDRAC10 漏液检测' },
  { id: 'K04', name: '机房电气安全与角色边界', course: 'SAFE', steps: ['S04', 'S18', 'S20'], principle: '配电送电、PDU 断路器、UPS 与制冷维修属于设施作业，只能由有资质的授权人员按设备程序执行；学生巡检以只读查看和报告为主。待机不等于断电，维修前须确认所有供电输入均已隔离。', reference: '华为 FusionModule2000 安装指南（2026）；NVIDIA DGX H100/H200 User Guide — Safety' },
  { id: 'K05', name: '设备档案与温度测点', course: 'SAFE', steps: ['S04', 'S19'], principle: '温度判断要绑定设备型号、固件和测点：机柜进风、GPU 芯片核心、显存以及 T.Limit 等测点含义各不相同，告警、降频、关断也是不同阈值。设备未提供的读数应记为未知并报告，不能补零或套用其他测点的阈值。', reference: 'NVIDIA nvidia-smi 文档；NVIDIA DGX SuperPOD H100 数据中心规划指南' },
  { id: 'K06', name: '安全事件分级与报告', course: 'SAFE', steps: ['S22'], principle: '安全事件报告应包含时间、影响范围、原因分析、处置措施与整改计划等要素，事件等级依据影响对象和影响程度判定。' },
  { id: 'K07', name: '事故复盘与整改闭环', course: 'SAFE', steps: ['S23'], principle: '整改措施应针对根本原因，在技术、管理和人员三个层面形成闭环；评价每条措施时，想一想它是否会同时带来新的风险或削弱追溯能力。' },
  { id: 'K08', name: '数据分类分级与个人信息', course: 'AI', steps: ['S05'], principle: '个人信息是能识别特定自然人的信息；其中一旦泄露易导致人格尊严或人身财产受损的为敏感个人信息，如身份证件号码、健康信息等。分级结果决定后续的处理与保护要求。', reference: '《中华人民共和国个人信息保护法》；GB/T 35273-2020' },
  { id: 'K09', name: '训练数据质量与投毒攻击', course: 'AI', steps: ['S08'], principle: '投毒攻击通过在训练集中混入恶意样本影响模型行为；可依据样本特征的统计偏离度识别异常样本，检测阈值需要在漏检与误报之间权衡。' },
  { id: 'K10', name: '大模型许可与合规使用', course: 'AI', steps: ['S11'], principle: '开源模型的许可证规定了可用范围（如是否允许商用、是否需署名）；使用前应核对许可条款与本次用途是否一致。', reference: '《生成式人工智能服务管理暂行办法》（2023）' },
  { id: 'K11', name: '提示注入攻击原理', course: 'AI', steps: ['S14'], principle: '提示注入是攻击者在输入或外部内容中夹带指令，试图改变模型原有行为，常见形式有“忽略之前指令”、角色越狱、在网页或文件中隐藏指令、诱导泄露机密。判断时关注输入是否试图改变系统规则，而不是话题是否敏感。' },
  { id: 'K12', name: '越狱与内容安全策略', course: 'AI', steps: ['S15'], principle: '内容安全处置应先判断请求意图与潜在后果：是正常的学习需求、可能造成危害或侵权的请求，还是提问者本人可能处于危险之中？不同情况需要不同的处置策略。' },
  { id: 'K13', name: '智能体工具调用与最小权限', course: 'AI', steps: ['S16'], principle: '智能体可调用的工具越多、权限越高，被注入后造成的危害越大。最小权限原则要求逐个思考每个工具在被恶意指令驱动时最坏能造成什么后果；管理面与任务面应隔离，涉及人身与设施安全的控制不应交给自动化的智能体。', reference: '阿里云 ECS 责任共担模型；华为云信任中心' },
  { id: 'K14', name: '算法公平性与偏见', course: 'AI', steps: ['S17'], principle: '模型在不同群体上的表现差异可能造成不公平结果；应选择与业务目标匹配的公平性指标，设定可接受阈值，超出时需要整改后才能使用。', reference: '《科技伦理审查办法（试行）》（2023）' },
  { id: 'K15', name: '数据来源与授权核查', course: 'AI', steps: ['S07'], principle: '用于模型训练的数据应有合法来源，并逐项核对知情同意的范围、审批情况与保存期限是否覆盖实际用途。', reference: '《中华人民共和国个人信息保护法》' },
  { id: 'K16', name: '图像空间域滤波', course: 'DIP', steps: ['S06'], principle: '均值、高斯等低通滤波对邻域像素加权平均，抑制高频细节（边缘、纹理）而保留低频结构；高斯核的标准差越大，平滑范围越大。' },
  { id: 'K17', name: '马赛克与块均值下采样', course: 'DIP', steps: ['S06'], principle: '马赛克用块内均值替换块内所有像素，相当于下采样后再放大；块越大丢失的细节越多，但过大的块也会抹去有用的结构信息。' },
  { id: 'K18', name: '图像去标识化与可用性评价', course: 'DIP', steps: ['S06'], principle: '去标识化要同时评价“身份是否仍可识别”和“任务信息是否保留”：完全涂黑或删除图像虽保护了隐私，但可能使后续识别任务无法进行。' },
  { id: 'K19', name: '拉普拉斯算子与高频能量', course: 'DIP', steps: ['S06'], principle: '拉普拉斯算子是二阶微分，对边缘与细节响应强；区域内拉普拉斯绝对值之和可近似衡量高频细节的多少。' },
  { id: 'K20', name: 'API 访问控制与密钥管理', course: 'NET', steps: ['S12', 'S13'], principle: 'API 密钥应按最小权限授予调用范围，并设置有效期与调用额度。判断处置方式时想一想：确认泄露后继续使用原密钥，攻击者还能做什么？' },
  { id: 'K21', name: '调用量监测与异常检测', course: 'NET', steps: ['S13'], principle: '通过按时间统计的调用量可以发现异常时段，告警阈值过低会产生大量误报，过高则会漏掉泄露。' },
  { id: 'K22', name: '数据外发通道', course: 'NET', steps: ['S16'], principle: '数据可经邮件、HTTP 请求参数或命令行上传等多种通道外发；阻断外泄需要逐一控制所有具备外发能力的通道。' },
  { id: 'K23', name: '日志审计与溯源', course: 'NET', steps: ['S21'], principle: '审计日志按时间与账号检索，可还原异常行为发生的时间窗和责任主体；时间窗与账号都需要与异常事件对应。' },
  { id: 'K24', name: '数据删除与介质清除', course: 'NET', steps: ['S09'], principle: '数据在一次实验中可能在多个环节留下副本。不同存储介质的清除原理不同：固态盘存在磨损均衡与预留空间，磁介质与云端副本又各有特点；清除后需要验证并留下记录，资产转移还要登记去向。', reference: 'NIST SP 800-88 Rev.2（2025）；阿里云 ECS 责任共担模型' },
  { id: 'K25', name: '一阶热路微分方程模型', course: 'MATH', steps: ['S19'], principle: '芯片温度可用一阶热路描述：C·dT/dt = P − (T − T_in)/R，功耗 P 随负载上升，热阻 R 随风扇转速增大而减小，稳态温度为 T_in + P·R。' },
  { id: 'K26', name: '检测阈值与精确率、召回率、F1', course: 'MATH', steps: ['S08', 'S13'], principle: '阈值越严，召回率越低、精确率越高；F1 是两者的调和平均，用于在漏检与误报之间寻找平衡点。' },
  { id: 'K27', name: '统计公平性指标', course: 'MATH', steps: ['S17'], principle: '人口统计均等差衡量不同群体获得正向结果的比例差，机会均等差衡量真实为正的样本在不同群体中被正确识别的比例差。' },
  { id: 'K28', name: '排序一致性度量', course: 'MATH', steps: ['S10', 'S18', 'S20'], principle: '两个排序的一致程度可用“顺序一致的成对比例”（Kendall 一致对）衡量，关键步骤的先后关系比个别位置更重要。' },
  { id: 'K29', name: '多目标权衡', course: 'MATH', steps: ['S06'], principle: '隐私保护与数据可用性往往此消彼长，可用加权综合指标在两者之间寻找最优方案。' }
];

export interface AbilityLevel {
  id: 'L1' | 'L2' | 'L3';
  name: string;
  goal: string;
  elements: string[];
  steps: string[];
  /** 达成要求：本层级得分率 */
  passRatio: number;
  excellentRatio: number;
}

/** 阶梯式能力标准：基础认知 → 综合设计 → 复杂问题研判与应急处置 */
export const ABILITY_LEVELS: AbilityLevel[] = [
  {
    id: 'L1', name: '安全认知与规范操作', goal: '能识别人工智能实验中的人员、数据、设备风险，按规范完成准入、巡检、清理和上电操作。',
    elements: ['安全制度与准入', '风险辨识', '数据分级', '设备与环境规范'],
    steps: ['S01', 'S02', 'S03', 'S04', 'S05', 'S09', 'S11', 'S18'], passRatio: 0.6, excellentRatio: 0.85
  },
  {
    id: 'L2', name: '综合设计与安全配置', goal: '能综合人工智能、图像处理与网络知识，设计脱敏、授权、密钥、内容安全和智能体权限方案。',
    elements: ['多课程知识综合', '隐私与可用性权衡', '最小权限设计', '报告撰写'],
    steps: ['S06', 'S07', 'S12', 'S14', 'S15', 'S16', 'S22'], passRatio: 0.6, excellentRatio: 0.85
  },
  {
    id: 'L3', name: '复杂问题研判与应急处置', goal: '能基于仿真数据建模分析、权衡阈值与参数，完成泄露、过温等突发事件的应急决策与复盘整改。',
    elements: ['数据驱动研判', '模型参数权衡', '应急决策', '复盘整改'],
    steps: ['S08', 'S10', 'S13', 'S17', 'S19', 'S20', 'S21', 'S23'], passRatio: 0.6, excellentRatio: 0.85
  }
];

export function knowledgeForStep(stepId: string): KnowledgePoint[] {
  return KNOWLEDGE_POINTS.filter((point) => point.steps.includes(stepId));
}

export function coursesForStep(stepId: string): Course[] {
  const ids = new Set(knowledgeForStep(stepId).map((point) => point.course));
  return COURSES.filter((course) => ids.has(course.id));
}

export interface LevelAttainment {
  id: AbilityLevel['id'];
  name: string;
  score: number;
  max: number;
  ratio: number;
  submitted: number;
  total: number;
  status: '未完成' | '未达成' | '达成' | '优秀';
}

export function buildLadder(records: Array<{ stepId: string; score: number; maxScore: number }>): LevelAttainment[] {
  return ABILITY_LEVELS.map((level) => {
    const items = records.filter((record) => level.steps.includes(record.stepId));
    const score = items.reduce((sum, record) => sum + record.score, 0);
    const max = items.reduce((sum, record) => sum + record.maxScore, 0);
    const ratio = max > 0 ? score / max : 0;
    const status = items.length < level.steps.length ? '未完成' : ratio >= level.excellentRatio ? '优秀' : ratio >= level.passRatio ? '达成' : '未达成';
    return { id: level.id, name: level.name, score: Number(score.toFixed(1)), max, ratio: Number(ratio.toFixed(3)), submitted: items.length, total: level.steps.length, status };
  });
}
