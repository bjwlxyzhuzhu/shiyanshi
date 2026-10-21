import { STEPS, nextStepId } from '@zhian/shared';
import { useSessionStore } from '../stores/session';
import { clearKeys } from './input';
import { HOTSPOT_BY_ID, SPAWN, STEP_HOTSPOT, hotspotForStep, yawToward } from './layout';
import { camera, player, useWorldStore } from './worldStore';

/** 某热点上可以打开的步骤：当前任务优先，否则最近一次已提交（只读回看） */
export function stepForHotspot(hotspotId: string): string | null {
  const { session } = useSessionStore.getState();
  if (!session) return null;
  const done = new Set(session.stepRecords.map((record) => record.stepId));
  if (STEP_HOTSPOT[session.currentStepId] === hotspotId) return session.currentStepId;
  const history = STEPS.filter((step) => STEP_HOTSPOT[step.id] === hotspotId && done.has(step.id));
  return history.length ? history[history.length - 1]!.id : null;
}

/** 明确的交互（E 或点击）：锁定移动，镜头推近设备，打开操作面板 */
export function interactWith(hotspotId: string): void {
  const world = useWorldStore.getState();
  if (world.mode !== 'exploring' || world.drawer !== 'none') return;
  const stepId = stepForHotspot(hotspotId);
  if (!stepId) return;
  clearKeys();
  useSessionStore.getState().view(stepId);
  world.focus(hotspotId);
}

/** 返回场景：关闭面板、恢复跟随；不自动提交 */
export function returnToWorld(): void {
  clearKeys();
  const world = useWorldStore.getState();
  const hotspot = world.focusHotspotId ? HOTSPOT_BY_ID.get(world.focusHotspotId) : null;
  if (hotspot) {
    // 相机回到人物背后：沿“站位 → 设备”的反方向
    camera.yaw = yawToward(hotspot.standPoint, hotspot.position);
    camera.pitch = 0.17;
  }
  world.release();
  const { session } = useSessionStore.getState();
  if (session) useSessionStore.getState().view(session.currentStepId);
}

/**
 * 继续实验：下一题在同一设备时直接换题面；在别处则返回场景并由导引带路。
 * 以服务端 SessionState 为准，不要求满分。
 */
export function continueFrom(stepId: string): void {
  const next = nextStepId(stepId);
  const { session } = useSessionStore.getState();
  if (!next || !session) return returnToWorld();
  const world = useWorldStore.getState();
  if (world.htmlMode) {
    useSessionStore.getState().view(next);
    return;
  }
  if (world.focusHotspotId && STEP_HOTSPOT[next] === world.focusHotspotId) {
    useSessionStore.getState().view(next);
    return;
  }
  returnToWorld();
}

/** 登录或刷新后：把人物放在当前任务设备的安全站位（服务端进度为准） */
export function placeAtCurrentTask(currentStepId: string, hasRecords: boolean, yaw?: number): void {
  const hotspot = hasRecords ? hotspotForStep(currentStepId) : undefined;
  if (hotspot) {
    player.x = hotspot.standPoint[0];
    player.z = hotspot.standPoint[1];
    player.yaw = yawToward(hotspot.standPoint, hotspot.position);
    camera.yaw = yaw ?? player.yaw;
  } else {
    player.x = SPAWN[0];
    player.z = SPAWN[1];
    player.yaw = -Math.PI / 2;
    camera.yaw = yaw ?? -Math.PI / 2;
  }
  camera.pitch = 0.17;
}
