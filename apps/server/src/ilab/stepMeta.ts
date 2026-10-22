/**
 * 24 步导出元数据：由 ilab-integration-kit-20261021/spec/24-step-mapping.json 生成（2026-10-21）。
 * scoringModel 为原评分规则说明（≤200字）；S24 自动报告不计入学生实际交互。
 */
export const STEP_EXPORT_META: Record<string, { scoringModel: string; countsAsStudentInteraction: boolean }> = {
  S01: { scoringModel: "清单正确率；选错与漏选按原评分模型处理", countsAsStudentInteraction: true },
  S02: { scoringModel: "维度识别60%＋等级判断40%", countsAsStudentInteraction: true },
  S03: { scoringModel: "清单正确率", countsAsStudentInteraction: true },
  S04: { scoringModel: "巡检清单80%＋环境温度20%", countsAsStudentInteraction: true },
  S05: { scoringModel: "七字段分类正确比例", countsAsStudentInteraction: true },
  S06: { scoringModel: "隐私与可用性综合分相对最佳策略归一化", countsAsStudentInteraction: true },
  S07: { scoringModel: "授权要件50%＋结论50%", countsAsStudentInteraction: true },
  S08: { scoringModel: "F1相对本数据集最优F1归一化", countsAsStudentInteraction: true },
  S09: { scoringModel: "清理位置70%＋方式30%", countsAsStudentInteraction: true },
  S10: { scoringModel: "顺序成对一致比例", countsAsStudentInteraction: true },
  S11: { scoringModel: "许可30%＋用途20%＋结论50%", countsAsStudentInteraction: true },
  S12: { scoringModel: "权限60%＋有效期20%＋额度20%", countsAsStudentInteraction: true },
  S13: { scoringModel: "检测F1占60%＋处置40%", countsAsStudentInteraction: true },
  S14: { scoringModel: "提示注入判断清单正确率", countsAsStudentInteraction: true },
  S15: { scoringModel: "四类请求处置正确比例", countsAsStudentInteraction: true },
  S16: { scoringModel: "工具权限合规60%＋外发拦截40%", countsAsStudentInteraction: true },
  S17: { scoringModel: "阈值30%＋结论一致性30%＋整改结论40%", countsAsStudentInteraction: true },
  S18: { scoringModel: "顺序成对一致比例", countsAsStudentInteraction: true },
  S19: { scoringModel: "温度60%＋负载40%", countsAsStudentInteraction: true },
  S20: { scoringModel: "顺序成对一致比例", countsAsStudentInteraction: true },
  S21: { scoringModel: "账号70%＋时间窗30%", countsAsStudentInteraction: true },
  S22: { scoringModel: "报告要素70%＋等级30%", countsAsStudentInteraction: true },
  S23: { scoringModel: "整改措施清单正确率", countsAsStudentInteraction: true },
  S24: { scoringModel: "原评分器固定完成分；报告生成状态另行核验", countsAsStudentInteraction: false }
};

/** 可能产生真实模型调用的场景（仅当实际发出请求并按口径计数时进入 ai_usage_scenarios） */
export const AI_SCENARIOS: Record<string, string> = {
  S10: '数据泄露应急方案智能评审',
  S23: '事故整改方案智能评审'
};
