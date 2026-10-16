// 渲染层：只读 world，不改逻辑。所有"手感"的视觉部分都在这里。
import { ARENA } from './content.js';

const TAU = Math.PI * 2;

const withAlpha = (hex, a) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
};
const mixHex = (a, b, k) => {
  const parse = (hex) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * k)}, ${Math.round(g1 + (g2 - g1) * k)}, ${Math.round(b1 + (b2 - b1) * k)})`;
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const { w, h } = ARENA;

  // 静态网格预渲染到离屏画布，省掉每帧几千次线条绘制
  const bg = document.createElement('canvas');
  bg.width = w;
  bg.height = h;
  const bx = bg.getContext('2d');
  const grad = bx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, h * 0.85);
  grad.addColorStop(0, '#0a1422');
  grad.addColorStop(0.6, '#070c15');
  grad.addColorStop(1, '#03050a');
  bx.fillStyle = grad;
  bx.fillRect(0, 0, w, h);
  bx.strokeStyle = 'rgba(79, 240, 255, 0.055)';
  bx.lineWidth = 1;
  for (let x = 0; x <= w; x += 40) {
    bx.beginPath();
    bx.moveTo(x + 0.5, 0);
    bx.lineTo(x + 0.5, h);
    bx.stroke();
  }
  for (let y = 0; y <= h; y += 40) {
    bx.beginPath();
    bx.moveTo(0, y + 0.5);
    bx.lineTo(w, y + 0.5);
    bx.stroke();
  }
  // 中线十字
  bx.strokeStyle = 'rgba(79, 240, 255, 0.12)';
  bx.beginPath();
  bx.moveTo(w / 2, 0);
  bx.lineTo(w / 2, h);
  bx.moveTo(0, h / 2);
  bx.lineTo(w, h / 2);
  bx.stroke();

  // 热量红晕：预渲染一张"边缘亮、中心透明"的图，靠全局透明度控制强度
  const vignette = document.createElement('canvas');
  vignette.width = w;
  vignette.height = h;
  {
    const vx = vignette.getContext('2d');
    const g = vx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.72);
    g.addColorStop(0, 'rgba(255,90,60,0)');
    g.addColorStop(0.55, 'rgba(255,90,60,0.12)');
    g.addColorStop(1, 'rgba(255,90,60,0.62)');
    vx.fillStyle = g;
    vx.fillRect(0, 0, w, h);
    vx.globalCompositeOperation = 'destination-in';
    const r2 = vx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
    r2.addColorStop(0, 'rgba(0,0,0,0)');
    r2.addColorStop(0.6, 'rgba(0,0,0,0.55)');
    r2.addColorStop(1, 'rgba(0,0,0,1)');
    vx.fillStyle = r2;
    vx.fillRect(0, 0, w, h);
  }

  const flash = { a: 0, color: '#ff5a3c' };

  function draw(world, opts = {}) {
    const { mouse } = opts;
    const shake = world.screenShake;
    const t = world.time;
    const p = world.player;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    ctx.drawImage(bg, 0, 0);

    // 场地边框：清场时呼吸提示
    const breathe = world.spawnQueue.length === 0 && world.enemies.length === 0 ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(79, 240, 255, ${0.25 + breathe * 0.55})`;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // 冲刺残影
    for (const p of world.players) {
      for (const tr of p.trail) {
        const a = Math.max(0, tr.life / 0.26) * 0.5;
        ctx.fillStyle = withAlpha(p.color, a);
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, p.radius * (0.5 + a), 0, TAU);
        ctx.fill();
      }
    }

    // 脉冲环
    for (const pulse of world.pulses ?? []) {
      const a = Math.max(0, pulse.life / 0.32);
      ctx.strokeStyle = `rgba(255, 90, 60, ${a * 0.9})`;
      ctx.lineWidth = 4 * a + 1;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.r, 0, TAU);
      ctx.stroke();
    }

    // 敌人
    for (const e of world.enemies) {
      drawEnemy(ctx, e, t);
    }

    // 子弹
    for (const b of world.bullets) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.r * 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.stroke();
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.9, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 敌方子弹
    for (const b of world.eBullets) {
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 粒子
    for (const q of world.particles) {
      const a = Math.max(0, Math.min(1, q.life / 0.35));
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      const s = q.size * (0.4 + a);
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // 玩家（支持双人）
    for (const p of world.players) {
      drawPlayer(ctx, world, p, t);
    }

    if (mouse) drawCursor(ctx, mouse, world);

    ctx.restore();

    // 屏幕特效：受击闪光 + 热量红晕（不参与震动）
    const heat = Math.max(...world.players.filter((x) => !x.down).map((x) => x.heat / x.stats.heatMax), 0);
    if (heat > 0.55 && !world.dead) {
      const k = (heat - 0.55) / 0.45;
      ctx.globalAlpha = k;
      ctx.drawImage(vignette, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (world.heatLock) {
      ctx.fillStyle = 'rgba(255, 60, 40, 0.10)';
      ctx.fillRect(0, 0, w, h);
    }
    if (flash.a > 0.001) {
      ctx.fillStyle = flash.color;
      ctx.globalAlpha = flash.a;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      flash.a *= 0.88;
    }

    // 多人时在每位玩家头顶标一个 P1 / P2，避免颜色看混
    if (world.players.length > 1) {
      ctx.font = 'bold 10px "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      for (const p of world.players) {
        ctx.fillStyle = withAlpha(p.color, p.down ? 0.35 : 0.9);
        ctx.fillText(p.name, p.x, p.y - p.radius - 8);
      }
    }
  }

  function hurt(amount) {
    flash.a = Math.min(0.5, 0.12 + amount / 120);
    flash.color = '#ff3b21';
  }

  return { draw, hurt };
}

function drawPlayer(ctx, world, p, t) {
  const r = p.radius;
  const heatRatio = Math.min(1, p.heat / p.stats.heatMax);
  // 机体颜色随热量偏红：热量机制的主要视觉反馈
  const base = p.down ? '#5a6b78' : mixHex(p.color, '#ff5a3c', Math.max(0, heatRatio - 0.55) / 0.45);

  if (p.down) {
    // 倒下的机体：残骸 + 归队倒计时环
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = 'rgba(120, 140, 155, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + t;
      const x = Math.cos(a) * r * 0.9;
      const y = Math.sin(a) * r * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    const total = 5;
    const left = Math.max(0, p.respawnT ?? 0);
    ctx.strokeStyle = withAlpha(p.color, 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, -Math.PI / 2, -Math.PI / 2 + (1 - left / total) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(p.x, p.y);

  // 瞄准线
  const lockAlpha = p.heatLock ? 0.06 : 0.22;
  ctx.strokeStyle = withAlpha(p.color, lockAlpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(p.aim) * 260, Math.sin(p.aim) * 260);
  ctx.stroke();

  // 无敌帧光环
  if (p.iframe > 0) {
    ctx.strokeStyle = `rgba(138, 255, 193, ${0.35 + 0.35 * Math.sin(t * 30)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, 0, TAU);
    ctx.stroke();
  }

  ctx.rotate(p.aim);
  // 机体：箭头
  ctx.shadowColor = base;
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#0b1c26';
  ctx.strokeStyle = base;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 0.9, r * 0.95);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.9, -r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 枪口火花
  if (p.muzzle > 0) {
    ctx.fillStyle = `rgba(255,255,255,${p.muzzle})`;
    ctx.beginPath();
    ctx.arc(r * 1.6, 0, 3 + p.muzzle * 3, 0, TAU);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEnemy(ctx, e, t) {
  const r = e.radius;
  ctx.save();
  ctx.translate(e.x, e.y);

  if (e.spawnT > 0) {
    // 入场提示环
    const k = 1 - e.spawnT / 0.45;
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.35 * k})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * (2.4 - k * 1.2), 0, TAU);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const hurt = e.hurt;
  const color = hurt > 0.05 ? '#ffffff' : e.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(6, 12, 20, 0.9)';
  ctx.lineWidth = 2;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 8 + hurt * 20;

  const rot = e.type === 'turret' ? Math.sin(t * 1.5 + e.phase) * 0.2 : t * 0.6 + e.phase;
  ctx.rotate(rot);

  const sides = e.type === 'tank' ? 6 : e.type === 'runner' ? 3 : e.type === 'turret' ? 4 : 5;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    const rr = e.type === 'runner' ? r * 1.35 : r;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 内核
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.6, r * 0.28), 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // 血条：只在受伤后显示
  if (e.hp < e.hpMax - 0.01) {
    const bw = r * 2.2;
    const ratio = Math.max(0, e.hp / e.hpMax);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(e.x - bw / 2, e.y - r - 9, bw, 3);
    ctx.fillStyle = ratio > 0.5 ? '#8affc1' : ratio > 0.22 ? '#ffd166' : '#ff5a3c';
    ctx.fillRect(e.x - bw / 2, e.y - r - 9, bw * ratio, 3);
  }
}

function drawCursor(ctx, mouse, world) {
  const { w, h } = ARENA;
  const x = Math.max(0, Math.min(w, mouse.x));
  const y = Math.max(0, Math.min(h, mouse.y));
  const hot = world.heatLock;
  ctx.strokeStyle = hot ? 'rgba(255,90,60,0.9)' : 'rgba(79,240,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, TAU);
  ctx.moveTo(x - 15, y);
  ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x + 15, y);
  ctx.moveTo(x, y - 15);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y + 15);
  ctx.stroke();
}
