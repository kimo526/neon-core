// 输入层：把键盘鼠标翻译成 input 对象，和 AI 用的是同一个接口。
//
// 单人：P1 = WASD + 鼠标瞄准 + 左键射击
// 双人：P1 同上；P2 = IJKL 移动 + 方向键瞄准 + 右 Shift/分号 射击 + 回车 冲刺
import { ARENA } from './content.js';

const P1_MOVE = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
const P2_MOVE = { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL' };
const P2_AIM = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const P2_FIRE = ['Semicolon', 'ShiftRight', 'Numpad0', 'Slash'];
const P2_DASH = ['Enter', 'NumpadEnter', 'ShiftRight'];

/** 方向键组合 → 8 向角度（和 AI 的键盘式瞄准用同一套取值） */
function aimAngleFromKeys(held, keys) {
  const up = held(keys.up);
  const down = held(keys.down);
  const left = held(keys.left);
  const right = held(keys.right);
  if (!up && !down && !left && !right) return null;
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  return Math.atan2(y, x);
}

export function createInput(canvas) {
  const keys = new Set();
  const state = { mx: 0, my: 0, lmb: false, dash1: false, dash2: false, pausePressed: false, soundPressed: false, voicePressed: false };
  const pos = { x: ARENA.w / 2, y: ARENA.h / 2 };
  let pressedKeys = [];

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      return;
    }
    keys.add(e.code);
    pressedKeys.push(e.code);
    if (e.code === 'Space') {
      state.dash1 = true;
      e.preventDefault();
    }
    if (P2_DASH.includes(e.code)) state.dash2 = true;
    if (e.code === 'Escape') state.pausePressed = true;
    if (e.code === 'KeyM') state.soundPressed = true;
    if (e.code === 'KeyV') state.voicePressed = true;
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Semicolon', 'Slash'].includes(
        e.code
      )
    ) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    state.lmb = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
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
  const axis = (m) => ({
    x: (held(m.right) ? 1 : 0) - (held(m.left) ? 1 : 0),
    y: (held(m.down) ? 1 : 0) - (held(m.up) ? 1 : 0),
  });

  function player1Input(world) {
    const a = axis(P1_MOVE);
    const p = world.players[0];
    let ax = pos.x;
    let ay = pos.y;
    // 方向键在单人模式下也能瞄准（不改鼠标位置）
    if (world.players.length === 1) {
      const k = aimAngleFromKeys(held, P2_AIM);
      if (k !== null) {
        ax = p.x + Math.cos(k) * 200;
        ay = p.y + Math.sin(k) * 200;
      }
    }
    return {
      moveX: a.x,
      moveY: a.y,
      aimX: ax,
      aimY: ay,
      aimAngle: null,
      firing: state.lmb || held('KeyJ'),
      dash: state.dash1,
      weaponId: held('Digit2') ? 'heavy' : 'ranger',
    };
  }

  function player2Input(world) {
    const a = axis(P2_MOVE);
    const p = world.players[1];
    const k = aimAngleFromKeys(held, P2_AIM);
    const aim = k ?? p.aim;
    return {
      moveX: a.x,
      moveY: a.y,
      aimAngle: aim,
      aimX: p.x + Math.cos(aim) * 200,
      aimY: p.y + Math.sin(aim) * 200,
      firing: held(...P2_FIRE),
      dash: state.dash2,
      weaponId: held('Digit9') ? 'heavy' : held('Digit8') ? 'ranger' : undefined,
    };
  }

  return {
    pos,
    /** 构造这一帧的输入：单人返回一份，双人返回 [P1, P2] */
    build(world) {
      const inputs = [player1Input(world)];
      if (world.players.length > 1) inputs.push(player2Input(world));
      state.dash1 = false;
      state.dash2 = false;
      return world.players.length > 1 ? inputs : inputs[0];
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
    takeSoundToggle() {
      const v = state.soundPressed;
      state.soundPressed = false;
      return v;
    },
    takeVoiceToggle() {
      const v = state.voicePressed;
      state.voicePressed = false;
      return v;
    },
    clear() {
      keys.clear();
      state.lmb = false;
      state.dash1 = false;
      state.dash2 = false;
      pressedKeys = [];
    },
  };
}
