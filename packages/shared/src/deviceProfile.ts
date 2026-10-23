/**
 * 设备档案。温度判断必须绑定“设备—测点—阈值含义—来源”，不能对所有 GPU 统一使用一个温度上限。
 * 实验使用的设备档案数值为教学设定（不代表任何厂商的真实参数）；如需替换为本校机房真实档案，按运维与厂商资料填入，
 * 未确认的字段保持 null，不补 0、不推定安全（依据：industry-lab-safety-kit-20261023，R10、R15）。
 */
export interface TemperatureThresholds {
  /** 告警：需要报告并干预 */
  warningC: number | null;
  /** 降频：设备开始限速保护 */
  slowdownC: number | null;
  /** 关断：设备保护性关机 */
  shutdownC: number | null;
}

export interface DeviceProfile {
  status: 'synthetic_teaching_profile' | 'needs_facility_and_vendor_confirmation' | 'approved';
  label: string;
  deviceId: string | null;
  model: string | null;
  firmware: string | null;
  coolingType: string | null;
  inletRangeC: [number, number] | null;
  /** 阈值所对应的测点；不同测点的阈值不能混用 */
  gpuMetric: 'GPU 核心温度' | '显存温度' | 'T.Limit 余量' | null;
  gpuThresholds: TemperatureThresholds;
  /** 设备未提供的读数（如显存温度）保持未知 */
  unavailableSensors: string[];
  electricalBudgetW: number | null;
  coolingBudgetW: number | null;
  leakSensorsSupported: boolean | null;
  source: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** 实验用设备档案：数值为教学设定，不是任何厂商的真实参数 */
export const SYNTHETIC_DEVICE_PROFILE: DeviceProfile = {
  status: 'synthetic_teaching_profile',
  label: '设备档案 · GPU-07',
  deviceId: 'GPU-07',
  model: 'GPU 训练服务器',
  firmware: 'v1.0',
  coolingType: '风冷',
  inletRangeC: [18, 27],
  gpuMetric: 'GPU 核心温度',
  gpuThresholds: { warningC: 80, slowdownC: 87, shutdownC: 92 },
  unavailableSensors: ['显存温度', 'T.Limit 余量'],
  electricalBudgetW: 3000,
  coolingBudgetW: 3200,
  leakSensorsSupported: true,
  source: '教学设定（参照 NVIDIA nvidia-smi 文档中“告警/降频/关断为不同阈值”的概念）',
  approvedBy: null,
  approvedAt: null
};

export function describeProfile(profile: DeviceProfile): string {
  const t = profile.gpuThresholds;
  const range = profile.inletRangeC ? `${profile.inletRangeC[0]}–${profile.inletRangeC[1]} °C` : '未知';
  const fmt = (value: number | null) => (value === null ? '未知' : `${value} °C`);
  return `【${profile.label}】设备 ${profile.deviceId ?? '未知'}（固件 ${profile.firmware ?? '未知'}，${profile.coolingType ?? '冷却方式未知'}）；进风温度允许范围 ${range}；` +
    `阈值对应测点：${profile.gpuMetric ?? '未知'}，告警 ${fmt(t.warningC)}、降频 ${fmt(t.slowdownC)}、关断 ${fmt(t.shutdownC)}；` +
    `本设备不提供：${profile.unavailableSensors.join('、') || '无'}。`;
}
