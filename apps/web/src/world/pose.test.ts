import { describe, expect, it } from 'vitest';
import { LIMB, STRIDE, limbEnd, poseAt } from './pose';

const PHASES = Array.from({ length: 72 }, (_, index) => (index / 72) * Math.PI * 2);

describe('步态关节方向（人物面朝 -Z，负 z 为身体前方）', () => {
  it('膝关节只向后弯（小腿不会反折到前方）', () => {
    for (const phase of PHASES) {
      const pose = poseAt(phase, 1, 0);
      expect(pose.kneeR).toBeLessThanOrEqual(0);
      expect(pose.kneeL).toBeLessThanOrEqual(0);
      // 屈膝时膝盖位于髋—脚连线前方
      const leg = limbEnd(pose.hipR, pose.kneeR, LIMB.thigh, LIMB.shin);
      const t = LIMB.thigh / (LIMB.thigh + LIMB.shin);
      expect(leg.midZ).toBeLessThanOrEqual(leg.z * t + 1e-9);
    }
  });

  it('肘关节只向前弯', () => {
    for (const phase of PHASES) {
      for (const op of [0, 1]) {
        const pose = poseAt(phase, 1, op);
        expect(pose.elbowR).toBeGreaterThan(0);
        expect(pose.elbowL).toBeGreaterThan(0);
      }
    }
  });

  it('左右腿交替，且同侧手臂与腿反向摆动', () => {
    let crossings = 0;
    for (const phase of PHASES) {
      const pose = poseAt(phase, 1, 0);
      const footR = limbEnd(pose.hipR, pose.kneeR, LIMB.thigh, LIMB.shin).z;
      const footL = limbEnd(pose.hipL, pose.kneeL, LIMB.thigh, LIMB.shin).z;
      if (Math.abs(pose.hipR) > 0.05) {
        expect(Math.sign(pose.hipR)).toBe(-Math.sign(pose.hipL));
        expect(Math.sign(pose.shoulderR)).toBe(-Math.sign(pose.hipR));
        expect(Math.sign(pose.shoulderL)).toBe(-Math.sign(pose.hipL));
        // 前摆的腿脚在身体前方
        if (pose.hipR > 0.2) expect(footR).toBeLessThan(footL);
      }
      if (phase > 0 && Math.sign(Math.sin(phase)) !== Math.sign(Math.sin(phase - Math.PI / 36))) crossings++;
    }
    expect(crossings).toBeGreaterThanOrEqual(1);
  });

  it('躯干与骨盆反向扭转：右腿在前时右肩向后', () => {
    const pose = poseAt(Math.PI / 2, 1, 0);
    expect(pose.hipR).toBeGreaterThan(0);
    // 绕 Y 旋转 θ 后，右肩（+X）的 z = -sin θ；向后即 z > 0
    expect(-Math.sin(pose.torsoY)).toBeGreaterThan(0);
  });

  it('前腿着地时脚尖上翘', () => {
    const pose = poseAt(Math.PI / 2, 1, 0);
    expect(pose.footR).toBeGreaterThan(0);
  });

  it('行走时躯干微前倾；操作终端时双手在身体前方并低头看屏幕', () => {
    expect(poseAt(1, 1, 0).torsoX).toBeLessThan(0);
    const operating = poseAt(0, 0, 1);
    const hand = limbEnd(operating.shoulderR, operating.elbowR, LIMB.upperArm, LIMB.forearm);
    expect(hand.z).toBeLessThan(-0.25);
    expect(operating.headX).toBeLessThan(0);
  });

  it('停步（walk=0）时四肢回到中立站姿，不原地摆动', () => {
    for (const phase of PHASES) {
      const pose = poseAt(phase, 0, 0);
      expect(Math.abs(pose.hipR) + Math.abs(pose.hipL) + Math.abs(pose.kneeR) + Math.abs(pose.kneeL)).toBe(0);
      expect(Math.abs(pose.shoulderR - pose.shoulderL)).toBe(0);
    }
  });

  it('脚步与地面基本不打滑：每周期两步的脚掌行程接近步长', () => {
    const pose = poseAt(Math.PI / 2, 1, 0);
    const reach = limbEnd(pose.hipR, pose.kneeR, LIMB.thigh, LIMB.shin).z - limbEnd(pose.hipL, pose.kneeL, LIMB.thigh, LIMB.shin).z;
    const perStep = STRIDE / 2;
    expect(Math.abs(reach)).toBeGreaterThan(perStep * 0.6);
    expect(Math.abs(reach)).toBeLessThan(perStep * 1.4);
  });
});
