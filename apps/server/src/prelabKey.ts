/** 预习测验答案与解析（仅服务端）；answer 为 PRELAB_QUESTIONS 中选项的下标 */
export const PRELAB_KEY: Record<string, { answer: number; explain: string }> = {
  Q01: { answer: 2, explain: '医疗健康信息属于法律规定的“敏感”类个人信息，处理时需单独同意并采取严格保护措施。' },
  Q02: { answer: 1, explain: '高斯核是低通滤波器，衰减边缘、纹理等高频分量，图像变平滑。' },
  Q03: { answer: 1, explain: '稳态时 dT/dt = 0，T = T_in + P·R，R 越小稳态温度越低。' },
  Q04: { answer: 0, explain: '阈值越低，判为异常的样本越多：查得更全（召回率升高），但误报也增加。' },
  Q05: { answer: 1, explain: '间接注入的指令不来自用户，而是混在模型被要求读取的外部内容里。' },
  Q06: { answer: 2, explain: '密钥只应在服务端使用；写在前端或公开仓库里的密钥任何人都能取得。' },
  Q07: { answer: 1, explain: '工具越多、权限越大，被恶意指令驱动时造成的危害越大。' },
  Q08: { answer: 1, explain: '学生巡检以只读查看和报告为主，设备检修属于授权人员的作业。' },
  Q09: { answer: 0, explain: '人口均等差比较各群体被模型判为正类的比例，差值越小越公平。' },
  Q10: { answer: 1, explain: '任何应急情景中，人身安全都优先于设备与数据。' }
};
