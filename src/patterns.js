// 弹幕模式库：雷霆战机 / 东方那种"成体系的弹幕"，不是随机撒子弹。
//
// 设计原则：
// 1. 每种弹幕都有自己的节奏和读法，玩家能"学会"它
// 2. 敌人子弹永远比玩家子弹粗、慢、颜色区分明显（红紫粉 vs 青黄）
// 3. 规模靠"节奏密度"堆，不靠单帧倾泻——否则既看不清也跑不动
//
// 所有函数都是纯的：接收 (world, e, 参数) → 往 world.eBullets 里塞子弹。

const TAU = Math.PI * 2;
const fmt = (deg) => (deg * Math.PI) / 180;

/** 朝某个角度打一发（可调速度/大小/存活/颜色） */
export function shot(world, x, y, angle, opts = {}) {
  const { speed = 190, r = 5, damage = 9, life = 6, color = '#ff5c8a', homing = 0, wave = 0 } = opts;
  world.eBullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    damage,
    life,
    color,
    homing,
    wave,
    born: world.time,
  });
}

/** 一圈 n 发；offset 是整圈的旋转角 */
export function ring(world, x, y, n, offset = 0, opts = {}) {
  for (let i = 0; i < n; i++) shot(world, x, y, offset + (i / n) * TAU, opts);
}

/** 一段扇形（自机狙常用的"扇射"） */
export function fan(world, x, y, center, count, spread, opts = {}) {
  if (count <= 1) {
    shot(world, x, y, center, opts);
    return;
  }
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5;
    shot(world, x, y, center + t * spread, opts);
  }
}

/** 朝目标的当前角度 */
export function angleTo(world, e, target) {
  const t = target ?? world.players.find((p) => !p.down) ?? world.players[0];
  return Math.atan2(t.y - e.y, t.x - e.x);
}

/** 移动预测：算目标以当前速度飞一段后的位置（自机狙才有的"准头"） */
export function leadAngle(world, e, speed, target) {
  const t = target ?? world.players.find((p) => !p.down) ?? world.players[0];
  const dist = Math.hypot(t.x - e.x, t.y - e.y);
  const tof = dist / Math.max(1, speed);
  const px = t.x + t.vx * tof * 0.65;
  const py = t.y + t.vy * tof * 0.65;
  return Math.atan2(py - e.y, px - e.x);
}

/** 朝最近（或指定）玩家打一发 */
export function aimedShot(world, e, opts = {}) {
  shot(world, e.x, e.y, angleTo(world, e, opts.target), { speed: 210, damage: 14, r: 6, color: '#ff5c8a', ...opts });
}

// ---------------------------------------------------------------------------
// 弹幕招式表。每条 = { name, cd, first?, shots, fn(world, e, aim, s) }
// ---------------------------------------------------------------------------

export const PATTERNS = [
  // 1. 螺旋：慢速旋转的弹链，读的是"缝在哪"
  {
    name: '螺旋',
    cd: 0.1,
    turn: 0.42,
    fn(world, e, aim, s) {
      ring(world, e.x, e.y, 2, s.turn, { speed: 132, r: 4.5, damage: 9, life: 7, color: '#c96bff' });
      s.turn += 0.33;
    },
  },
  // 2. 环形爆发：一圈慢弹 + 一圈快弹，逼你找两层之间的空档
  {
    name: '环形爆发',
    cd: 1.5,
    fn(world, e, aim, s) {
      ring(world, e.x, e.y, 16, s.turn, { speed: 118, r: 6, damage: 11, life: 6.5, color: '#ff5c8a' });
      ring(world, e.x, e.y, 16, s.turn + TAU / 32, { speed: 205, r: 4, damage: 10, life: 4.5, color: '#ff9ad4' });
      s.turn += 0.2;
    },
  },
  // 3. 自机狙扇射：朝你打，带一点预判
  {
    name: '自机狙',
    cd: 0.85,
    fn(world, e, aim, s) {
      const a = leadAngle(world, e, 240);
      fan(world, e.x, e.y, a, 3, fmt(14), { speed: 240, r: 5, damage: 13, life: 4, color: '#ff4d6d' });
      if (s.count % 4 === 3) {
        fan(world, e.x, e.y, aim, 5, fmt(30), { speed: 195, r: 4.5, damage: 11, life: 4.5, color: '#ff86b0' });
      }
    },
  },
  // 4. 弹墙：一圈密弹里留一个缺口，缺口在缓慢旋转 —— 必须"读缝"
  {
    name: '弹墙',
    cd: 1.15,
    fn(world, e, aim, s) {
      const n = 26;
      const gap = 3;
      for (let i = 0; i < n; i++) {
        if (i < gap) continue;
        shot(world, e.x, e.y, s.turn + (i / n) * TAU, { speed: 152, r: 5.5, damage: 12, life: 7, color: '#ff7a4d' });
      }
      s.turn += 0.34;
    },
  },
  // 5. 米字弹：突然的静止十字，专门惩罚站着不动的
  {
    name: '米字弹',
    cd: 1.0,
    fn(world, e, aim, s) {
      ring(world, e.x, e.y, 8, s.turn, { speed: 175, r: 5, damage: 11, life: 5, color: '#ffb03a' });
      s.turn += 0.3926; // 22.5°
    },
  },
  // 6. 追踪弹：慢速转弯，逼你走位而不是原地微调
  {
    name: '追踪弹',
    cd: 1.6,
    fn(world, e, aim, s) {
      fan(world, e.x, e.y, aim, 4, fmt(40), { speed: 120, r: 6, damage: 15, life: 7, color: '#a06bff', homing: 1.5 });
    },
  },
];

/** 敌人按招式表出手（普通小怪用，简单但成体系） */
export function pickPattern(world, e, patterns = PATTERNS, min = 0, max = null) {
  const list = max === null ? patterns.slice(min) : patterns.slice(min, max);
  if (!list.length) return null;
  return list[Math.floor(world.rng() * list.length)];
}

/**
 * Boss 招式序列：每一招连续打一段时间，然后轮换。
 * 返回 { patterns, phase }，其中 patterns 是 [{ pattern, until }] 的时间线。
 */
export function bossPhases(wave) {
  const t = 6.2;
  return [
    { hpAbove: 0.65, patterns: [{ i: 0, until: t }, { i: 3, until: t * 2 }, { i: 2, until: t * 3 }] },
    { hpAbove: 0.3, patterns: [{ i: 1, until: t }, { i: 2, until: t * 2 }, { i: 4, until: t * 3 }, { i: 0, until: t * 4 }] },
    { hpAbove: -1, patterns: [{ i: 5, until: t }, { i: 1, until: t * 2 }, { i: 3, until: t * 3 }, { i: 4, until: t * 4 }, { i: 2, until: t * 5 }] },
  ];
}
