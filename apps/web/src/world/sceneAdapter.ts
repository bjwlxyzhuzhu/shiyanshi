import { useMemo } from 'react';
import { AGENT_TOOLS, CONTENT_CASES, INJECTION_SAMPLES, STEPS, parseList, type ChartData, type SessionState } from '@zhian/shared';
import { inputHash, inputOf, useSessionStore } from '../stores/session';
import { HOTSPOTS, STEP_HOTSPOT, ZONES, type ZoneId } from './layout';
import { useWorldStore } from './worldStore';

/**
 * SceneAdapter：把输入、最近一次正式结果、当前有效预览与 dirty 状态
 * 映射成同一世界里的设备表现。它不判分、不引用 scoring、不修改服务端数据。
 * 没有正式结果时只显示“待验证”，不显示假的拦截、达标或分数。
 */
export type HotspotStatus = 'current' | 'history' | 'locked';
export type SlotState = 'neutral' | 'selected' | 'correct' | 'wrong';
export type TraceOutcome = '执行' | '被拦截' | '待人工确认';

export interface TraceHop {
  action: string;
  tool: string;
  outcome: TraceOutcome;
}

export interface SceneState {
  hotspots: Record<string, HotspotStatus>;
  unlockedZones: Set<ZoneId>;
  currentHotspotId: string | null;
  currentZone: ZoneId | null;
  sandbox: { step: 'S14' | 'S15'; slots: SlotState[]; verified: boolean };
  agent: { levels: string[]; trace: TraceHop[] | null; dirty: boolean };
  cooling: { fanPct: number; peakC: number | null; limitC: number | null; stale: boolean; active: boolean };
  power: { drill: boolean; s18Recorded: boolean; s20Recorded: boolean };
  inspection: { verified: boolean; ambientOk: boolean | null };
  stages: Array<{ label: string; done: number; total: number; current: boolean }>;
}

const STAGES = [...new Set(STEPS.map((step) => step.stage))];

function chartPeak(chart: ChartData | null | undefined): number | null {
  if (!chart?.series[0]?.values.length) return null;
  return Math.max(...chart.series[0].values);
}

export function reachableSteps(session: SessionState | null): Set<string> {
  const reachable = new Set<string>();
  if (!session) return reachable;
  for (const record of session.stepRecords) reachable.add(record.stepId);
  reachable.add(session.currentStepId);
  return reachable;
}

export function useSceneState(): SceneState {
  const session = useSessionStore((state) => state.session);
  const inputs = useSessionStore((state) => state.inputs);
  const results = useSessionStore((state) => state.results);
  const submitted = useSessionStore((state) => state.submitted);
  const previews = useSessionStore((state) => state.previews);
  const viewStepId = useSessionStore((state) => state.viewStepId);
  const focusHotspotId = useWorldStore((state) => state.focusHotspotId);

  return useMemo(() => {
    const done = new Set(session?.stepRecords.map((record) => record.stepId) ?? []);
    const current = session && !(session.finished && done.has(session.currentStepId)) ? session.currentStepId : null;
    const hotspots: Record<string, HotspotStatus> = {};
    for (const hotspot of HOTSPOTS) hotspots[hotspot.id] = 'locked';
    const unlockedZones = new Set<ZoneId>();
    for (const step of STEPS) {
      const hotspotId = STEP_HOTSPOT[step.id]!;
      const zone = HOTSPOTS.find((item) => item.id === hotspotId)!.zone;
      if (step.id === current) {
        hotspots[hotspotId] = 'current';
        unlockedZones.add(zone);
      } else if (done.has(step.id)) {
        if (hotspots[hotspotId] !== 'current') hotspots[hotspotId] = 'history';
        unlockedZones.add(zone);
      }
    }
    if (!session) unlockedZones.add('admission');
    const currentHotspotId = current ? STEP_HOTSPOT[current]! : null;
    const currentZone = currentHotspotId ? HOTSPOTS.find((item) => item.id === currentHotspotId)!.zone : null;

    const input = (stepId: string) => inputOf(inputs, stepId);
    const freshResult = (stepId: string) => {
      const result = results[stepId];
      if (!result) return null;
      const hash = submitted[stepId];
      const dirty = hash !== undefined && hash !== inputHash(inputOf(inputs, stepId));
      return dirty ? null : result;
    };

    // 沙箱：正在操作或当前任务是 S15 时显示 S15，否则 S14
    const sandboxStep: 'S14' | 'S15' =
      (focusHotspotId === 'sandbox-terminal' && viewStepId === 'S15') || (focusHotspotId !== 'sandbox-terminal' && current === 'S15') ? 'S15' : 'S14';
    let slots: SlotState[];
    let verified = false;
    if (sandboxStep === 'S14') {
      const flagged = new Set(parseList(input('S14').flagged));
      const verdicts = freshResult('S14')?.result.verdicts as Array<{ text: string; injected: boolean }> | undefined;
      verified = Boolean(verdicts);
      slots = INJECTION_SAMPLES.map((text) => {
        const selected = flagged.has(text);
        const verdict = verdicts?.find((item) => item.text === text);
        if (verdict) return verdict.injected === selected ? 'correct' : 'wrong';
        return selected ? 'selected' : 'neutral';
      });
    } else {
      slots = CONTENT_CASES.map((_, index) => {
        const value = String(input('S15')[`case${index + 1}`] ?? '正常回答');
        return value === '正常回答' ? 'neutral' : 'selected';
      });
    }

    const agentInput = input('S16');
    const agentResult = freshResult('S16');
    const agent = {
      levels: AGENT_TOOLS.map((tool) => String(agentInput[`tool_${tool}`] ?? '自动允许')),
      trace: (agentResult?.result.trace as TraceHop[] | undefined) ?? null,
      dirty: Boolean(results.S16) && !agentResult
    };

    const coolingPreview = previews.S19;
    const previewFresh = coolingPreview && coolingPreview.forHash === inputHash(input('S19')) && coolingPreview.status === 'ok';
    const coolingChart = previewFresh ? coolingPreview.chart : (freshResult('S19')?.result.chart as ChartData | undefined) ?? null;
    const cooling = {
      fanPct: Number(input('S19').fanPct ?? 30),
      peakC: chartPeak(coolingChart),
      limitC: coolingChart?.threshold?.value ?? null,
      stale: Boolean(coolingPreview && !previewFresh),
      active: current === 'S19' || (focusHotspotId === 'cooling-terminal')
    };

    const power = {
      drill: (current === 'S20' || (focusHotspotId === 'power-terminal' && viewStepId === 'S20')) && !results.S20,
      s18Recorded: done.has('S18'),
      s20Recorded: done.has('S20')
    };

    const s04 = freshResult('S04');
    const inspection = {
      verified: Boolean(s04),
      // 进风读数本身超出档案范围；指示灯反映学生是否按档案正确判断并报告
      ambientOk: s04 ? String(s04.result['判断'] ?? '') === '正确' : null
    };

    const stages = STAGES.map((label) => {
      const steps = STEPS.filter((step) => step.stage === label);
      return {
        label,
        done: steps.filter((step) => done.has(step.id)).length,
        total: steps.length,
        current: steps.some((step) => step.id === current)
      };
    });

    return { hotspots, unlockedZones, currentHotspotId, currentZone, sandbox: { step: sandboxStep, slots, verified }, agent, cooling, power, inspection, stages };
  }, [session, inputs, results, submitted, previews, viewStepId, focusHotspotId]);
}

export const ZONE_IDS = ZONES.map((zone) => zone.id);
