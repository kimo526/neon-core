// 一个会用走位/瞄准/闪避的简易 AI，用来做无头平衡测试和"数字陪玩"。
// 它只读取 world 状态、输出 input，和人类玩家走的是同一套接口。
import { ARENA } from './content.js';

export function createBot(opts = {}) {
  const cfg = {
    keepDistance: 210,
    strafeBias: 1,
    aimTolerance: 0.28,
    // 自带的 RNG 种子：保证"同一颗种子 → 完全相同的对局"，让平衡测试可复现
    seed: 1,
    ...opts,
  };
  let rngState = (cfg.seed >>> 0) ^ 0x9e3779b9;
  const rnd = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let strafeDir = 1;
  let strafeT = 0;
  let dtAcc = 0;
  return {
    cfg,
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false, dash: false },
    think(world, dt = 1 / 60) {
      const p = world.player;
      const out = this.input;
      out.dash = false;
      out.firing = false;

      const { w, h } = ARENA;

      // --- 找目标：优先最近的敌人，其次最近的敌方子弹作为威胁 ---
      let target = null;
      let bestD = Infinity;
      let incoming = null;
      let bestIncoming = Infinity;

      for (const e of world.enemies) {
        if (e.spawnT > 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) {
          bestD = d;
          target = e;
        }
      }
      for (const b of world.eBullets) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < bestIncoming && d < 200) {
          bestIncoming = d;
          incoming = b;
        }
      }

      // --- 瞄准：预判提前量 ---
      let aimX = p.x + Math.cos(p.aim) * 200;
      let aimY = p.y + Math.sin(p.aim) * 200;
      let aimErr = 0;
      if (target) {
        const speedGuess = 720;
        const tof = bestD / speedGuess;
        const px = target.x + target.vx * tof;
        const py = target.y + target.vy * tof;
        aimX = px;
        aimY = py;
        aimErr = Math.abs(angleDiff(Math.atan2(py - p.y, px - p.x), p.aim));
      }
      out.aimX = aimX;
      out.aimY = aimY;
      // 过热了就主动松扳机散热，散热到一半再继续打（人类也是这么干的）
      const heatRatio = p.heat / p.stats.heatMax;
      out.firing = !!target && aimErr < cfg.aimTolerance && heatRatio < 0.72;

      // --- 走位 ---
      dtAcc += dt;
      strafeT -= dt;
      if (strafeT <= 0) {
        strafeT = 1.2 + rnd() * 1.6;
        strafeDir *= -1;
      }

      let mx = 0;
      let my = 0;
      const cx = w / 2;
      const cy = h / 2;
      // 离墙远一点
      mx += ((cx - p.x) / cx) * 0.45;
      my += ((cy - p.y) / cy) * 0.45;

      if (target) {
        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = dx / d;
        const ny = dy / d;
        const close = bestD < cfg.keepDistance * 0.75;
        const far = bestD > cfg.keepDistance * 1.45;
        const radial = close ? 1.15 : far ? -0.8 : 0;
        mx += nx * radial;
        my += ny * radial;
        // 侧移
        mx += -ny * strafeDir * cfg.strafeBias * 0.75;
        my += nx * strafeDir * cfg.strafeBias * 0.75;
      }

      if (incoming) {
        const d = Math.hypot(incoming.x - p.x, incoming.y - p.y) || 1;
        mx += ((p.x - incoming.x) / d) * 0.9;
        my += ((p.y - incoming.y) / d) * 0.9;
        if (bestIncoming < 70) out.dash = true;
      }

      const m = Math.hypot(mx, my) || 1;
      out.moveX = mx / m;
      out.moveY = my / m;

      // 贴脸就冲刺拉开
      if (target && bestD < 74 && p.dashCd <= 0) out.dash = true;
      // 卡墙也别原地等死
      if (p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 40) {
        if (p.dashCd <= 0 && rnd() < 0.08) out.dash = true;
      }
      return out;
    },
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
