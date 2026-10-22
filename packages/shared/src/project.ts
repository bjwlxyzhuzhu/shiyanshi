/**
 * 申报项目信息（与申报书“基本情况”“项目团队”保持一致）。
 * 承担任务为依据各成员主讲课程拟定的草稿，需团队确认；出生年月、职务、电话、邮箱不在系统中保存。
 */
export interface TeamMember {
  order: number;
  name: string;
  title: string;
  degree?: string;
  course: string;
  role: string;
}

export const TEAM: TeamMember[] = [
  { order: 1, name: '朱丽叶', title: '讲师', degree: '硕士', course: '人工智能概论', role: '项目负责人：总体教学设计与实验系统建设，大模型与智能体应用、数据安全与模型安全模块，组织校内教学应用' },
  { order: 2, name: '樊攀', title: '副教授', degree: '博士', course: '数字图像处理', role: '图像去标识化实验模块设计（空间域滤波、马赛克与可识别性评价），三维场景视觉效果指导' },
  { order: 3, name: '陈冬', title: '副教授', degree: '博士', course: '计算机网络', role: 'API 密钥与访问控制、智能体外发链路拦截、日志审计与溯源模块，系统网络与安全部署' },
  { order: 4, name: '李亚峰', title: '教授', course: '数学建模', role: 'GPU 热路微分方程模型、检测阈值与 F1 权衡、公平性指标与评分模型设计' },
  { order: 5, name: '张雪亚', title: '副教授', degree: '硕士', course: '实验室安全', role: '实验室准入、机房巡检、上电与过温断电应急、安全事件报告规范与安全审核' }
];

export const PROJECT_INFO = {
  name: '人工智能实验安全风险识别与应急处置虚拟仿真实验',
  direction: '实验室安全专题（人工智能实验安全）',
  leader: '朱丽叶',
  experimentType: '综合设计型',
  nature: '课程实验',
  necessity: ['高危或极端环境', '不可逆操作', '大型综合训练'],
  language: '中文',
  courses: ['人工智能概论', '数字图像处理', '计算机网络', '数学建模', '实验室安全'],
  /** 专业类代码候选（《普通高等学校本科专业目录（2026）》），由学校按实际开设专业确定 */
  majorCategoryCandidates: [
    { code: '0809', name: '计算机类', majors: ['080901 计算机科学与技术', '080903 网络工程', '080904K 信息安全', '080910T 数据科学与大数据技术', '080911TK 网络空间安全'] },
    { code: '0807', name: '电子信息类', majors: ['080717T 人工智能'] }
  ]
};
