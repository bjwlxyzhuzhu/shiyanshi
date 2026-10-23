import { round } from './metrics.js';

export interface GpuThermalResult {
  timeS: number[];
  tempC: number[];
  peakC: number;
  steadyC: number;
  powerW: number;
}

/**
 * 一阶热路降阶模型：C·dT/dt = P − (T − T_in)/R。
 * 功耗随负载线性增加，热阻随风扇转速下降。用于教学反馈，不替代厂商热设计数据。
 */
export function simulateGpuThermal(loadPct: number, fanPct: number, ambientC: number, durationS = 600): GpuThermalResult {
  const load = Math.min(1, Math.max(0, loadPct / 100));
  const fan = Math.min(1, Math.max(0.2, fanPct / 100));
  const powerW = 120 + 280 * load;
  const resistance = 0.22 - 0.14 * fan;
  const tau = 90;
  const steadyC = ambientC + powerW * resistance;

  const timeS: number[] = [];
  const tempC: number[] = [];
  let temp = ambientC + 10;
  const dt = 10;
  for (let t = 0; t <= durationS; t += dt) {
    timeS.push(t);
    tempC.push(round(temp, 1));
    temp += ((steadyC - temp) / tau) * dt;
  }
  return {
    timeS,
    tempC,
    peakC: round(Math.max(...tempC), 1),
    steadyC: round(steadyC, 1),
    powerW: round(powerW, 0)
  };
}
