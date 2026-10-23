/**
 * 研究探索（选做，不计入 100 分）：学生针对一个研究问题提出假设，自主设计并运行至少 3 组参数，
 * 依据仿真数据写出结论；系统按试验数据给出趋势反馈。对应建设标准 1“由综合设计性向研究探索性实验转变”。
 */
export interface ExploreVariable {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ExploreMetric {
  key: string;
  label: string;
  unit?: string;
}

export interface Exploration {
  id: string;
  title: string;
  question: string;
  /** 复用的仿真步骤（只取仿真数据，不评分） */
  stepId: string;
  /** 固定的其他输入 */
  fixed: Record<string, string | number>;
  variables: ExploreVariable[];
  metrics: ExploreMetric[];
  /** 关联知识点 */
  kps: string[];
}

export const EXPLORATIONS: Exploration[] = [
  {
    id: 'E1',
    title: '散热参数对 GPU 峰值温度的影响',
    question: '在负载不变时，风扇转速与进风温度分别怎样影响 GPU 峰值温度？哪个参数更敏感？',
    stepId: 'S16',
    fixed: { metric: 'GPU 核心温度' },
    variables: [
      { key: 'fanPct', label: '风扇转速', unit: '%', min: 20, max: 100, step: 5, default: 50 },
      { key: 'ambientC', label: '进风温度', unit: '°C', min: 15, max: 40, step: 1, default: 24 },
      { key: 'loadPct', label: 'GPU 负载', unit: '%', min: 10, max: 100, step: 5, default: 90 }
    ],
    metrics: [{ key: 'peakC', label: '峰值温度', unit: '°C' }, { key: 'powerW', label: '功耗', unit: 'W' }],
    kps: ['K25', 'K05']
  },
  {
    id: 'E2',
    title: '去标识化强度与数据可用性的权衡',
    question: '马赛克块边长或模糊半径增大时，人脸细节残留与护目镜信息保留各怎样变化？是否存在兼顾两者的区间？',
    stepId: 'S06',
    fixed: { name: '假名化', phone: '删除', idCard: '删除', health: '泛化为类别', photo: '人脸区域高斯模糊' },
    variables: [{ key: 'strength', label: '处理强度', unit: '像素', min: 1, max: 12, step: 1, default: 2 }],
    metrics: [{ key: 'identifiability', label: '人脸细节残留' }, { key: 'taskUtility', label: '护目镜信息保留' }],
    kps: ['K16', 'K18', 'K29']
  },
  {
    id: 'E3',
    title: '检测阈值对投毒检测效果的影响',
    question: '离群阈值从低到高变化时，精确率、召回率和 F1 如何变化？最优阈值大约在哪里？',
    stepId: 'S08',
    fixed: { method: '离群度 + 触发词扫描' },
    variables: [{ key: 'threshold', label: '离群阈值（z 分数）', min: 0.5, max: 5, step: 0.1, default: 1.5 }],
    metrics: [{ key: 'precision', label: '精确率' }, { key: 'recall', label: '召回率' }, { key: 'f1', label: 'F1' }],
    kps: ['K09', 'K26']
  }
];

export const MIN_EXPLORE_TRIALS = 3;
