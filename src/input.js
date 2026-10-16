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

  // ---------- 触屏：左侧虚拟摇杆移动，右侧自动瞄准最近的敌人 ----------
  // 手机上没法做鼠标瞄准，所以干脆做成"自动索敌"：你只负责走位和冲刺，
  // 这也正好和"擦弹/走位"的核心玩法对得上。
  const touch = { id: null, ox: 0, oy: 0, x: 0, y: 0, move: { x: 0, y: 0 }, firing: false, dashQueued: false, dashAt: -99 };
  const isTouchDevice = () => (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia('(pointer: coarse)').matches;

  function toGame(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * ARENA.w,
      y: ((clientY - rect.top) / rect.height) * ARENA.h,
    };
  }

  function nearestEnemyTo(pos) {
    let best = null;
    let bestD = Infinity;
    for (const e of world) {
      if (e.spawnT > 0) continue;
      const d = Math.hypot(e.x - pos.x, e.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (!isTouchDevice()) return;
      for (const t of e.changedTouches) {
        const g = toGame(t.clientX, t.clientY);
        if (t.clientX - canvas.getBoundingClientRect().left < canvas.getBoundingClientRect().width * 0.45) {
          if (touch.id === null) {
            touch.id = t.identifier;
            touch.ox = g.x;
            touch.oy = g.y;
            touch.x = g.x;
            touch.y = g.y;
          }
        } else {
          // 右半边：点一下 = 冲刺（短促），按住 = 持续开火（子弹仍然自动索敌）
          touch.firing = true;
          const now = performance.now();
          if (now - touch.dashAt > 260) {
            touch.dashQueued = true;
            touch.dashAt = now;
          }
        }
      }
      e.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touch.id) continue;
        const g = toGame(t.clientX, t.clientY);
        touch.x = g.x;
        touch.y = g.y;
        const dx = touch.x - touch.ox;
        const dy = touch.y - touch.oy;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 46); // 摇杆死区/最大行程
        touch.move.x = (dx / d) * k;
        touch.move.y = (dy / d) * k;
      }
      e.preventDefault();
    },
    { passive: false }
  );

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) {
        touch.id = null;
        touch.move.x = 0;
        touch.move.y = 0;
      }
      touch.firing = false;
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  /** 触屏玩家的输出：移动来自摇杆，瞄准自动索敌，开火自动 */
  function touchInput(world) {
    const p = world.players[0];
    let aimX = p.x + Math.cos(p.aim) * 200;
    let aimY = p.y + Math.sin(p.aim) * 200;
    let firing = touch.firing;
    const target = nearestEnemyTo(world.enemies);
    if (target) {
      // 提前量：和 AI 用同一套算法
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      const tof = d / 720;
      aimX = target.x + target.vx * tof;
      aimY = target.y + target.vy * tof;
      firing = true; // 有目标就自动开火，玩家只需要走位
    }
    return {
      moveX: touch.move.x,
      moveY: touch.move.y,
      aimX,
      aimY,
      aimAngle: null,
      firing,
      dash: touch.dashQueued,
      weaponId: 'ranger',
    };
  }

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
      const useTouch = isTouchDevice();
      const inputs = [useTouch ? touchInput(world) : player1Input(world)];
      if (world.players.length > 1) inputs.push(player2Input(world));
      state.dash1 = false;
      state.dash2 = false;
      touch.dashQueued = false;
      return world.players.length > 1 ? inputs : inputs[0];
    },
    /** 触屏上的虚拟摇杆状态，给渲染层画指示用 */
    get touchState() {
      return isTouchDevice() ? touch : null;
    },
    get isTouch() {
      return isTouchDevice();
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
