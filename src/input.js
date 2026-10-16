// 输入层：把键盘鼠标翻译成一份 input 对象，和 AI 用的是同一个接口。
import { ARENA } from './content.js';

export function createInput(canvas) {
  const keys = new Set();
  const state = { mx: 0, my: 0, lmb: false, dashBuffer: false, pausePressed: false };
  const pos = { x: ARENA.w / 2, y: 0 };
  let pressedKeys = [];

  const canvasRect = () => canvas.getBoundingClientRect();

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
      return;
    }
    keys.add(e.code);
    pressedKeys.push(e.code);
    if (e.code === 'Space') {
      state.dashBuffer = true;
      e.preventDefault();
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Escape') state.pausePressed = true;
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    state.lmb = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvasRect();
    pos.x = ((e.clientX - rect.left) / rect.width) * ARENA.w;
    pos.y = ((e.clientY - rect.top) / rect.height) * ARENA.h;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) state.lmb = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.lmb = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const held = (...codes) => codes.some((c) => keys.has(c));

  return {
    pos,
    /** 每帧构造 input；consume 之后的一次性状态（冲刺/暂停）会被清掉 */
    build(world, dt) {
      let mx = 0;
      let my = 0;
      if (held('KeyA')) mx -= 1;
      if (held('KeyD')) mx += 1;
      if (held('KeyW')) my -= 1;
      if (held('KeyS')) my += 1;

      let ax = this.pos.x;
      let ay = this.pos.y;
      if (held('ArrowLeft')) ax = world.player.x - 200;
      if (held('ArrowRight')) ax = world.player.x + 200;
      if (held('ArrowUp')) ay = world.player.y - 200;
      if (held('ArrowDown')) ay = world.player.y + 200;

      const input = {
        moveX: mx,
        moveY: my,
        aimX: ax,
        aimY: ay,
        firing: state.lmb || held('KeyJ'),
        dash: state.dashBuffer,
        weaponId: held('Digit2') ? 'heavy' : 'ranger',
        dt,
      };
      state.dashBuffer = false;
      return input;
    },
    takePressed() {
      const out = pressedKeys;
      pressedKeys = [];
      return out;
    },
    takePause() {
      const v = state.pausePressed;
      state.pausePressed = false;
      return v;
    },
    clear() {
      keys.clear();
      state.lmb = false;
      state.dashBuffer = false;
      pressedKeys = [];
    },
  };
}
