/**
 * 键盘输入：WASD/方向键移动，E 交互（边沿触发，忽略长按 repeat），H 提示，Esc 返回。
 * 焦点在输入控件或对话框时不消费任何热键；失焦、切标签、打开面板时清空按键，防止粘键。
 */
const MOVE_KEYS: Record<string, 'f' | 'b' | 'l' | 'r'> = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r'
};

const pressed = new Set<'f' | 'b' | 'l' | 'r'>();
type Handler = () => void;
const handlers: { interact: Handler[]; hint: Handler[]; escape: Handler[] } = { interact: [], hint: [], escape: [] };

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return Boolean(target.closest('[role="dialog"], [data-block-keys]'));
}

export function clearKeys(): void {
  pressed.clear();
}

/** 归一化的移动意图（x: 右为正，y: 前为正） */
export function moveIntent(): [number, number] {
  let x = 0;
  let y = 0;
  if (pressed.has('f')) y += 1;
  if (pressed.has('b')) y -= 1;
  if (pressed.has('r')) x += 1;
  if (pressed.has('l')) x -= 1;
  const length = Math.hypot(x, y);
  return length > 0 ? [x / length, y / length] : [0, 0];
}

export function onKey(kind: keyof typeof handlers, handler: Handler): () => void {
  handlers[kind].push(handler);
  return () => {
    handlers[kind] = handlers[kind].filter((item) => item !== handler);
  };
}

let installed = false;

export function installInput(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Esc 在任何焦点下都可用于返回场景，但不打断原生下拉框的关闭
      if (event.target instanceof HTMLSelectElement) return;
      handlers.escape.forEach((handler) => handler());
      return;
    }
    if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const move = MOVE_KEYS[event.code];
    if (move) {
      pressed.add(move);
      if (event.code.startsWith('Arrow')) event.preventDefault();
      return;
    }
    if (event.repeat) return;
    if (event.code === 'KeyE') handlers.interact.forEach((handler) => handler());
    else if (event.code === 'KeyH') handlers.hint.forEach((handler) => handler());
  });

  window.addEventListener('keyup', (event) => {
    const move = MOVE_KEYS[event.code];
    if (move) pressed.delete(move);
  });

  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);
  // 焦点进入表单控件时立即松开所有移动键
  document.addEventListener('focusin', (event) => {
    if (isTypingTarget(event.target)) clearKeys();
  });
}
