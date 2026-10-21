/**
 * 程序化步态：纯函数，便于测试关节方向。
 * 约定：人物面朝 -Z；所有关节绕本地 X 轴旋转，正角度让下垂肢体摆向 -Z（前方）。
 * 因此：髋/肩正值 = 向前摆；膝只能取负值（小腿向后弯）；肘只能取正值（前臂向前弯）。
 * R 为人物右侧（+X），L 为左侧（-X）。
 */
export const LIMB = { thigh: 0.42, shin: 0.42, upperArm: 0.28, forearm: 0.25 };
/** 一个完整步态周期（左右各一步）对应的行进距离 */
export const STRIDE = 1.5;

export interface Pose {
  hipR: number;
  hipL: number;
  kneeR: number;
  kneeL: number;
  footR: number;
  footL: number;
  shoulderR: number;
  shoulderL: number;
  elbowR: number;
  elbowL: number;
  /** 躯干前倾（负值 = 向前） */
  torsoX: number;
  /** 躯干扭转：与骨盆/腿相反，右腿在前时右肩向后 */
  torsoY: number;
  /** 低头为负值 */
  headX: number;
  /** 骨盆上下起伏 */
  pelvisLift: number;
}

/**
 * @param phase 步态相位（随有效位移增长）
 * @param walk  行走权重 0..1（停步时衰减，不原地滑步）
 * @param op    操作权重 0..1（面向终端伸手）
 */
export function poseAt(phase: number, walk: number, op: number): Pose {
  const s = Math.sin(phase);
  const swing = 0.5 * walk * (1 - 0.6 * op);
  // 摆动期屈膝：右腿向前摆（髋角速度为正）时屈膝最大
  const flexR = Math.max(0, Math.sin(phase + 0.7)) * 0.85 * walk;
  const flexL = Math.max(0, Math.sin(phase + 0.7 + Math.PI)) * 0.85 * walk;
  const armSwing = 0.42 * walk * (1 - op);
  const reach = 0.95 * op;
  return {
    hipR: s * swing,
    hipL: -s * swing,
    kneeR: -flexR,
    kneeL: -flexL,
    // 前腿着地时脚尖上翘，后腿蹬地时脚尖下压
    footR: Math.max(0, s) * 0.22 * walk - Math.max(0, -s) * 0.12 * walk + flexR * 0.3,
    footL: Math.max(0, -s) * 0.22 * walk - Math.max(0, s) * 0.12 * walk + flexL * 0.3,
    // 对侧摆臂：右腿向前时右臂向后
    shoulderR: -s * armSwing + reach,
    shoulderL: s * armSwing + reach,
    elbowR: 0.16 + 0.25 * walk * Math.max(0, -s) + 0.6 * op,
    elbowL: 0.16 + 0.25 * walk * Math.max(0, s) + 0.6 * op,
    torsoX: -0.06 * walk - 0.12 * op,
    torsoY: -s * 0.08 * walk,
    headX: 0.04 * walk - 0.16 * op,
    pelvisLift: Math.abs(Math.cos(phase)) * 0.028 * walk - 0.014 * walk
  };
}

/** 矢状面正向运动学：返回肢体末端相对根关节的前后位置（负值 = 在身体前方）与高度 */
export function limbEnd(rootAngle: number, midAngle: number, upper: number, lower: number): { z: number; y: number; midZ: number } {
  const midZ = -Math.sin(rootAngle) * upper;
  const midY = -Math.cos(rootAngle) * upper;
  const total = rootAngle + midAngle;
  return { z: midZ - Math.sin(total) * lower, y: midY - Math.cos(total) * lower, midZ };
}
