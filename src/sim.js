// NEON CORE — 纯逻辑模拟层（支持 1–2 名玩家）。
// 这一层完全不碰 DOM：可以在浏览器里跑，也可以在 node 里以 60Hz 无头跑几千帧做平衡测试。
import {
  ARENA,
  COOP,
  ENEMY_SCALING,
  ENEMY_TYPES,
  EXTREME,
  GRAZE,
  MODES,
  PLAYER_COLORS,
  TUNING,
  PLAYER,
  WEAPONS,
  grantHeal,
} from './content.js';
import { CARDS, createStats, rollCards } from './upgrades.js';
import { PATTERNS, bossPhases, pickPattern } from './patterns.js';

const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** mulberry32：可复现的伪随机，方便"同一个种子复现同一局"和写回归测试 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const makeInput = (x = ARENA.w * 0.5, y = 0) => ({
  moveX: 0,
  moveY: 0,
  aimX: x,
  aimY: y,
  firing: false,
  dash: false,
});

function makePlayer(index, stats, world) {
  const p = {
    index,
    id: index + 1,
    name: index === 0 ? 'P1' : 'P2',
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    x: ARENA.w * (index === 0 ? 0.38 : 0.62),
    y: ARENA.h * (index === 0 ? 0.62 : 0.38),
    vx: 0,
    vy: 0,
    radius: PLAYER.radius,
    aim: -Math.PI / 2,
    hp: stats.hpMax,
    stats,
    weaponId: stats.weapon,
    fireCd: 0,
    heat: 0,
    dashT: 0,
    dashCd: 0,
    charges: 1 + Math.max(0, stats.dashCharges),
    iframe: TUNING.spawnIframe,
    pulseHits: null,
    trail: [],
    down: false,
    heatLock: false,
    muzzle: 0,
    stunT: 0,
    stunned: 0,
    shield: 0,
    jackpots: 0,
    graze: 0,
    grazeCharge: 0,
    grazeFlash: 0,
    statsRun: { kills: 0, shots: 0, hits: 0, timeAlive: 0, damageDealt: 0 },
    _world: world,
  };
  return p;
}

export function createWorld(seed = 1, opts = {}) {
  const { playerCount = 1, coopBonus = COOP.enemyBonus, mode = 'standard' } = opts;
  const modedef = MODES[mode] ?? MODES.standard;
  const rng = makeRng(seed);
  const world = {
    seed,
    rng,
    time: 0,
    mode: modedef.id,
    noHeal: modedef.noHeal,
    arena: { ...ARENA },
    playerCount: clamp(playerCount, 1, 2),
    coopBonus: playerCount > 1 ? coopBonus : 1,
    timeScale: 1,
    players: [],
    bullets: [],
    eBullets: [],
    enemies: [],
    particles: [],
    pulses: [],
    trails: [],
    // 特殊攻击（红黑"超载回满"）：0.1% 的触发率，world 上可覆盖以便测试/调试
    jackpot: { life: 0, x: 0, y: 0, id: 0 },
    spawnQueue: [],
    wave: 1,
    phase: 'play',
    cardChoices: [[], []],
    screenShake: 0,
    hitStop: 0,
    dead: false,
    waveClearT: 0,
    stats: { waves: 0, kills: 0 },
    events: [],
    _id: 0,
  };
  for (let i = 0; i < world.playerCount; i++) {
    world.players.push(makePlayer(i, createStats(), world));
  }
  spawnWave(world, 1);
  return world;
}

/** 1 号玩家的便捷引用（单人场景/测试里少写点字） */
export const p1 = (world) => world.players[0];

/** 场上的 Boss（没有则 null）——HUD 画血条用 */
export const activeBoss = (world) => world.enemies.find((e) => e.boss) ?? null;

/** 还活着（没倒下）的玩家 */
export const alivePlayers = (world) => world.players.filter((p) => !p.down);

const ev = (world, type, data) => world.events.push({ type, ...data });

export function playerOf(world, bullet) {
  return world.players.find((p) => p.id === bullet.owner);
}

/** 按波次生成敌人配比（纯函数，方便测试"第 20 波到底出什么"） */
export function waveComposition(wave, coopBonus = 1) {
  const list = [];
  const add = (type, count) => {
    const n = Math.max(0, Math.round(count * coopBonus));
    for (let i = 0; i < n; i++) list.push(type);
  };
  add('drone', 3 + Math.floor(wave * 1.3));
  if (wave >= 2) add('runner', 1 + Math.floor((wave - 1) * 0.7));
  if (wave >= 4) add('tank', 1 + Math.floor((wave - 4) / 2));
  if (wave >= 3) add('turret', Math.floor(wave / 3));
  // 每 5 波一个弹幕 Boss：这一波的主题就是"读弹"
  if (wave % 5 === 0) list.push('boss');
  return list;
}

function scaleFor(wave, coopBonus = 1) {
  const k = wave - 1;
  const hpMul = 1 + (coopBonus - 1) * COOP.hpSharing;
  return {
    hp: Math.pow(ENEMY_SCALING.hp, k) * hpMul,
    speed: Math.pow(ENEMY_SCALING.speed, k),
    // 慢速复利：高波次依然危险，但不会变成"一碰就死"
    damage: Math.pow(1 + ENEMY_SCALING.damagePerWave, k),
  };
}

export function spawnWave(world, wave) {
  const comp = waveComposition(wave, world.coopBonus);
  const scale = scaleFor(wave, world.coopBonus);
  const lead = 0.65;
  const gap = world.coopBonus > 1 ? 0.22 : 0.28;
  world.spawnQueue = comp.map((type, i) => ({ type, at: lead + i * gap, scale }));
  ev(world, 'waveStart', { wave });
}

function edgeSpawn(world) {
  const { w, h } = world.arena;
  const side = Math.floor(world.rng() * 4);
  const pad = 26;
  if (side === 0) return { x: pad + world.rng() * (w - pad * 2), y: pad };
  if (side === 1) return { x: w - pad, y: pad + world.rng() * (h - pad * 2) };
  if (side === 2) return { x: pad + world.rng() * (w - pad * 2), y: h - pad };
  return { x: pad, y: pad + world.rng() * (h - pad * 2) };
}

function spawnEnemy(world, type, scale) {
  const def = ENEMY_TYPES[type];
  const p = edgeSpawn(world);
  const isBoss = !!def.boss;
  // Boss 血量随波次增长，保证第 20 波的 Boss 和第 5 波不是一个东西
  const hp = def.hp * (isBoss ? Math.pow(1.16, world.wave - 5) : scale.hp);
  world.enemies.push({
    id: ++world._id,
    type,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    radius: def.radius,
    hp,
    hpMax: hp,
    speed: def.speed * (isBoss ? 1 : scale.speed),
    accel: def.accel,
    damage: def.damage,
    color: def.color,
    ranged: !!def.ranged,
    boss: isBoss,
    fireCd: isBoss ? 1.6 : def.ranged ? 1.2 + world.rng() * 0.8 : 0,
    patternCd: 0,
    pattern: isBoss
      ? { phase: 0, timeline: bossPhases(world.wave), idx: 0, startedAt: 0, state: { turn: world.rng() * 6, count: 0 } }
      : def.ranged
        ? { idx: Math.floor(world.rng() * 4), state: { turn: world.rng() * 6, count: 0 } }
        : null,
    hurt: 0,
    spawnT: isBoss ? 1.1 : 0.45,
    stunned: 0,
    knockX: 0,
    knockY: 0,
    phase: world.rng() * TAU,
    targetId: 0,
  });
  if (isBoss) ev(world, 'bossSpawn', { x: p.x, y: p.y, wave: world.wave });
}

function spawnParticles(world, x, y, n, color, opts = {}) {
  const { speed = 180, life = 0.42, size = 2, dir = null, spread = TAU, slow = 6 } = opts;
  for (let i = 0; i < n; i++) {
    const a = dir === null ? world.rng() * TAU : dir + (world.rng() - 0.5) * spread;
    const s = speed * (0.35 + world.rng() * 0.9);
    world.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.6 + world.rng() * 0.8),
      maxLife: life,
      size: size * (0.6 + world.rng() * 0.8),
      color,
      slow,
    });
  }
}

/** 敌人挑目标：谁近打谁（多人时这天然形成"拉仇恨"的合作玩法） */
function acquireTarget(world, e) {
  let best = null;
  let bestD = Infinity;
  for (const p of world.players) {
    if (p.down) continue;
    const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    e.targetId = best.id;
    return best;
  }
  return null;
}

function nearestPlayer(world, e) {
  let best = null;
  let bestD = Infinity;
  for (const p of world.players) {
    if (p.down) continue;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** 主更新：世界每帧只依赖 (world, inputs, dt)，没有隐藏的全局状态 */
export function step(world, inputs, dt) {
  if (dt <= 0) return world;
  world.events = [];

  // 命中定格：让打击有"顿挫感"
  let scale = 1;
  if (world.hitStop > 0) {
    world.hitStop = Math.max(0, world.hitStop - dt);
    scale = 0.18;
  }
  const sdt = dt * scale * world.timeScale;
  world.time += sdt;

  const list = normalizeInputs(world, inputs);

  updateSpawns(world, sdt);
  updateRespawns(world);
  for (const p of world.players) {
    if (!p.down) updatePlayer(world, p, list[p.index] ?? list[0], sdt);
  }
  updateLowHpAlert(world);
  updateEnemies(world, sdt);
  updateBullets(world, sdt);
  updateTrails(world, sdt);
  updateEnemyBullets(world, sdt);
  updateParticles(world, sdt);
  updateWave(world, sdt);

  world.screenShake = Math.max(0, world.screenShake - dt * 42);
  world.jackpot.life = Math.max(0, world.jackpot.life - dt);
  for (const p of world.players) {
    p.muzzle = Math.max(0, p.muzzle - dt * 8);
    if (!p.down) p.statsRun.timeAlive += sdt;
  }
  return world;
}

/** 兼容单份 input 和 input 数组两种调用方式 */
function normalizeInputs(world, inputs) {
  if (Array.isArray(inputs)) {
    // 数组下标对应玩家顺序（不是玩家 id），保证索引安全
    return world.players.map((p, i) => inputs[i] ?? inputs[0] ?? {});
  }
  return world.players.map((p, i) => (i === 0 ? inputs : {}));
}

/** 倒地的玩家会在 COOP.respawnDelay 后满血归队，让双人局能继续打下去 */
function updateRespawns(world) {
  if (world.playerCount < 2) return;
  for (const p of world.players) {
    if (!p.down) continue;
    p.respawnT = (p.respawnT ?? COOP.respawnDelay) - 1 / 60;
    if (p.respawnT > 0) continue;
    p.down = false;
    p.hp = p.stats.hpMax;
    p.iframe = TUNING.reviveIframe;
    p.heat = 0;
    p.heatLock = false;
    p.charges = 1 + Math.max(0, p.stats.dashCharges);
    ev(world, 'playerRevived', { id: p.id, spawn: true });
  }
}

/** 残血警报：极限模式下血量只会往下走，所以低于 30% 就周期性报警 */
function updateLowHpAlert(world) {
  let low = false;
  for (const p of world.players) {
    if (p.down) continue;
    if (p.hp / p.stats.hpMax <= 0.3) low = true;
  }
  if (!low) return;
  if (world.time - (world.lastLowHpAlert ?? -99) < 1.6) return;
  world.lastLowHpAlert = world.time;
  ev(world, 'lowHp', { hp: Math.min(...world.players.filter((p) => !p.down).map((p) => p.hp)) });
}

function updateSpawns(world, dt) {
  if (!world.spawnQueue.length) return;
  const ready = [];
  world.spawnQueue = world.spawnQueue.filter((q) => {
    if (q.at <= world.time) {
      ready.push(q);
      return false;
    }
    return true;
  });
  for (const q of ready) spawnEnemy(world, q.type, q.scale);
}

function updateWave(world, dt) {
  if (world.phase !== 'play') return;
  // 还有敌人在场（含 Boss）就不算清场：Boss 必须被打死
  if (world.spawnQueue.length || world.enemies.length) return;
  world.waveClearT += dt;
  if (world.waveClearT < TUNING.waveClearDelay) return;
  world.waveClearT = 0;
  world.stats.waves = world.wave;
  ev(world, 'waveClear', { wave: world.wave });

  const next = world.wave + 1;
  if (world.wave % 2 === 1) {
    world.phase = 'upgrade';
    // 每个还站着的玩家各抽三张，互不重复
    world.cardChoices = world.players.map((p) => (p.down ? [] : rollCards(world.rng, TUNING.cardCount).map((c) => c.id)));
    ev(world, 'upgradeOffered', { wave: world.wave });
  }
  world.wave = next;
  spawnWave(world, next);
}

function updatePlayer(world, p, input, dt) {
  const st = p.stats;

  // 武器切换：换枪会重置热量
  if (input.weaponId && input.weaponId !== st.weapon && WEAPONS[input.weaponId]) {
    st.weapon = input.weaponId;
    const w = WEAPONS[input.weaponId];
    Object.assign(st, {
      damage: w.damage,
      fireRate: w.fireRate,
      bulletSpeed: w.speed,
      spread: w.spread,
      pellets: w.pellets,
      bulletLife: w.life,
      bulletRadius: w.radius,
      bulletKnockback: w.knockback,
      pierce: w.pierce,
      heatPerShot: w.heatPerShot,
      heatMax: w.heatMax,
      heatCool: w.heatCool,
    });
    p.heat = 0;
    p.heatLock = false;
  }

  // 方向键瞄准：直接给一个 8 向角度
  if (input.aimAngle !== undefined && input.aimAngle !== null) {
    p.aim = input.aimAngle;
  } else if (input.aimX !== undefined) {
    p.aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);
  }

  // 移动：加速度 + 摩擦，手感偏"滑"但不飘
  let mx = clamp(input.moveX ?? 0, -1, 1);
  let my = clamp(input.moveY ?? 0, -1, 1);
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  const moving = mag > 0.01;
  const dashing = p.dashT > 0;

  if (dashing) {
    p.dashT -= dt;
    p.trail.push({ x: p.x, y: p.y, life: 0.26 });
    if (p.dashT <= 0) p.pulseHits = null;
  } else {
    p.vx += mx * st.accel * dt;
    p.vy += my * st.accel * dt;
    const fr = Math.exp(-TUNING.friction * dt);
    if (!moving) {
      p.vx *= fr;
      p.vy *= fr;
    }
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > st.speed) {
      p.vx = (p.vx / sp) * st.speed;
      p.vy = (p.vy / sp) * st.speed;
    }
  }

  // 冲刺：有充能就能连着放，冷却只在你把充能打完时才卡你
  const maxCharges = 1 + Math.max(0, st.dashCharges);
  p.charges = Math.min(p.charges, maxCharges);
  if (p.dashCd > 0) {
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.dashCd === 0) p.charges = maxCharges; // 冷却走完，充能回满
  }
  const canDash = p.dashT <= 0 && p.charges > 0;
  if (input.dash && canDash) {
    const dir = moving ? Math.atan2(my, mx) : p.aim;
    p.dashT = st.dashTime;
    p.vx = Math.cos(dir) * st.dashSpeed;
    p.vy = Math.sin(dir) * st.dashSpeed;
    p.iframe = Math.max(p.iframe, TUNING.dashIframe);
    p.charges -= 1;
    if (p.charges <= 0) p.dashCd = st.dashCooldown;
    p.pulseHits = st.dashPulse > 0 ? new Set() : null;
    // 冲刺构筑：护盾 / 熔核尾迹 / 破空（在起步瞬间震住身边敌人，不然人已经飞出去了）
    if (st.shieldOnDash > 0) p.shield = Math.min(st.shieldMax, p.shield + st.shieldOnDash);
    if (st.trailDamage > 0) {
      world.trails.push({ owner: p.id, x: p.x, y: p.y, r: st.trailRadius, life: st.trailLife, maxLife: st.trailLife, dps: st.trailDamage, cd: new Map() });
    }
    if (st.dashStun > 0) {
      for (const e of world.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < e.radius + 70) e.stunned = Math.max(e.stunned, st.dashStun);
      }
    }
    ev(world, 'dash', { id: p.id, x: p.x, y: p.y, dir, charges: p.charges, dashDamage: st.dashDamage });
    spawnParticles(world, p.x, p.y, 8, '#8affc1', { speed: 200, life: 0.3, dir: dir + Math.PI, spread: 1.2 });
  }

  // 冲刺结束：急停爆发
  if (dashing && p.dashT <= 0) {
    if (st.burstOnDash) {
      for (let i = 0; i < 8; i++) {
        pushBullet(world, p, st, (i / 8) * TAU, st.damage * 0.55);
      }
      p.charges = Math.min(1 + Math.max(0, st.dashCharges), p.charges + 1);
      p.dashCd = Math.max(0, p.dashCd - 0.4); // 急停返还一点冷却，让"冲刺—爆发—再冲刺"能连上
      ev(world, 'dashBurst', { id: p.id, x: p.x, y: p.y });
      spawnParticles(world, p.x, p.y, 12, '#8affc1', { speed: 300, life: 0.25 });
    }
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // 撞墙：反弹衰减一点，别贴脸不动
  const r = p.radius;
  const { w, h } = world.arena;
  if (p.x < r) {
    p.x = r;
    p.vx = Math.abs(p.vx) * 0.2;
  } else if (p.x > w - r) {
    p.x = w - r;
    p.vx = -Math.abs(p.vx) * 0.2;
  }
  if (p.y < r) {
    p.y = r;
    p.vy = Math.abs(p.vy) * 0.2;
  } else if (p.y > h - r) {
    p.y = h - r;
    p.vy = -Math.abs(p.vy) * 0.2;
  }

  p.iframe = Math.max(0, p.iframe - dt);
  for (const t of p.trail) t.life -= dt;
  p.trail = p.trail.filter((t) => t.life > 0);

  // 开火 + 热量：按住扳机就完全不散热，想降温必须松手（核心节奏）
  p.fireCd -= dt;
  const heatMul = st.anchor ? (moving ? 0.7 : 2.4) : 1;
  const cooling = (st.heatCool * (p.heatLock ? TUNING.overheatCoolMul : 1)) * heatMul;
  const wantFire = !!input.firing;
  if (!wantFire && p.heat > 0) {
    p.heat = Math.max(0, p.heat - cooling * dt);
  }
  // 过热锁：降到 release 比例就解锁，避免"罚站 3 秒多"
  if (p.heatLock && p.heat <= st.heatMax * TUNING.heatRelease) {
    p.heatLock = false;
    ev(world, 'cooledDown', { id: p.id, heat: p.heat });
  }
  if (wantFire && !p.heatLock && p.fireCd <= 0 && p.dashT <= 0) {
    fire(world, p, st);
  }

  // 回复（极限模式走 grantHeal，不会真的回血）
  if (st.regen > 0) grantHeal(world, p, st.regen * dt);

  // 擦弹值：不擦就慢慢冷掉（擦弹闪光也在这里衰减）
  if (p.grazeCharge > 0) p.grazeCharge = Math.max(0, p.grazeCharge - GRAZE.decay * dt);
  if (p.grazeFlash > 0) p.grazeFlash = Math.max(0, p.grazeFlash - dt);
}

function fire(world, p, st) {
  p.fireCd = st.fireRate;
  p.heat = Math.min(st.heatMax, p.heat + st.heatPerShot);
  p.statsRun.shots += st.pellets;
  p.muzzle = 1;

  const thermo = 1 + st.thermo * clamp(p.heat / st.heatMax, 0, 1);
  const muzzleX = p.x + Math.cos(p.aim) * (p.radius + 4);
  const muzzleY = p.y + Math.sin(p.aim) * (p.radius + 4);

  for (let i = 0; i < st.pellets; i++) {
    const jitter = st.pellets > 1 ? (world.rng() - 0.5) * st.spread : (world.rng() - 0.5) * st.spread * 0.6;
    pushBullet(world, p, st, p.aim + jitter, st.damage * thermo, muzzleX, muzzleY);
  }
  spawnParticles(world, muzzleX, muzzleY, st.pellets > 1 ? 8 : 4, '#bff9ff', {
    speed: 260,
    life: 0.18,
    size: 1.6,
    dir: p.aim,
    spread: 0.9,
  });
  ev(world, 'shoot', { id: p.id, x: muzzleX, y: muzzleY, pellets: st.pellets, weapon: st.weapon });

  if (p.heat >= st.heatMax) {
    p.heatLock = true;
    ev(world, 'overheat', { id: p.id, x: p.x, y: p.y });
    if (st.ventBlast) {
      spawnParticles(world, p.x, p.y, 26, '#ff5a3c', { speed: 380, life: 0.5, size: 2.4 });
      world.pulses.push({ owner: p.id, x: p.x, y: p.y, r: 8, maxR: 130, life: 0.32, damage: 26, hits: new Set(), color: '#ff5a3c' });
    }
  }
}

/** 生成一发子弹（普通射击和急停爆发共用） */
function pushBullet(world, p, st, angle, damage, x = null, y = null, over = {}) {
  const ox = x ?? p.x + Math.cos(angle) * (p.radius + 4);
  const oy = y ?? p.y + Math.sin(angle) * (p.radius + 4);
  world.bullets.push({
    x: ox,
    y: oy,
    vx: Math.cos(angle) * st.bulletSpeed,
    vy: Math.sin(angle) * st.bulletSpeed,
    r: st.bulletRadius,
    damage,
    life: st.bulletLife,
    pierce: st.pierce,
    ricochet: st.ricochet,
    knock: st.bulletKnockback,
    hit: new Set(),
    owner: p.id,
    color: st.weapon === 'heavy' ? '#ffd166' : '#8ff6ff',
    ...over,
  });
}

function updateEnemies(world, dt) {
  for (const e of world.enemies) {
    e.hurt = Math.max(0, e.hurt - dt * 4);
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      continue;
    }
    // 破空：被冲刺震住的敌人短暂停摆
    if (e.stunned > 0) {
      e.stunned -= dt;
      e.vx *= Math.exp(-6 * dt);
      e.vy *= Math.exp(-6 * dt);
      continue;
    }
    e.stunned = 0;

    // 击退
    e.x += e.knockX * dt;
    e.y += e.knockY * dt;
    const kd = Math.exp(-8 * dt);
    e.knockX *= kd;
    e.knockY *= kd;

    // 目标：优先沿用上一次锁定的玩家（攻击有连贯性），目标倒了再重新挑最近的
    let target = world.players.find((p) => p.id === e.targetId && !p.down) ?? acquireTarget(world, e);
    if (!target) continue;
    e.targetId = target.id;

    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    if (e.speed > 0) {
      // 追逐 + 轻微绕行，避免所有敌人挤成一条线
      const weave = Math.sin(world.time * 2.4 + e.phase) * 0.35;
      const tx = nx + -ny * weave;
      const ty = ny + nx * weave;
      e.vx += tx * e.accel * dt;
      e.vy += ty * e.accel * dt;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > e.speed) {
        e.vx = (e.vx / sp) * e.speed;
        e.vy = (e.vy / sp) * e.speed;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }

    // 分离：互相推开，避免完全重叠（也让穿透弹更值钱）
    for (const o of world.enemies) {
      if (o === e || o.spawnT > 0) continue;
      const ddx = e.x - o.x;
      const ddy = e.y - o.y;
      const d2 = ddx * ddx + ddy * ddy;
      const minD = e.radius + o.radius;
      if (d2 > 1e-4 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = ((minD - d) / minD) * 120 * dt;
        e.x += (ddx / d) * push;
        e.y += (ddy / d) * push;
      }
    }

    // 远程敌人 / Boss：走弹幕招式表
    if (e.ranged) {
      // 站位：炮台原地，Boss 保持中距离慢慢绕
      if (e.boss) {
        const want = 250;
        const toward = dist > want + 40 ? 1 : dist < want - 40 ? -1 : 0;
        const strafe = Math.sin(world.time * 0.7 + e.phase) * 0.8;
        e.x += (nx * toward - ny * strafe) * 46 * dt;
        e.y += (ny * toward + nx * strafe) * 46 * dt;
        e.x = clamp(e.x, e.radius, world.arena.w - e.radius);
        e.y = clamp(e.y, e.radius, world.arena.h - e.radius);
      } else {
        const want = 220;
        const toward = dist > want + 30 ? 1 : dist < want - 30 ? -1 : 0;
        e.x += nx * toward * 40 * dt;
        e.y += ny * toward * 40 * dt;
      }
      firePattern(world, e, dt, Math.atan2(dy, dx));
    }

    // 接触伤害
    if (dist < e.radius + target.radius && target.iframe <= 0) {
      damagePlayer(world, target, e.damage, e.x, e.y);
      e.knockX -= nx * 260;
      e.knockY -= ny * 260;
    }

    // 冲刺脉冲（每个玩家独立判定；相位刀锋会放大这个伤害）
    for (const dp of world.players) {
      if (dp.down || dp.dashT <= 0 || !dp.pulseHits || dp.pulseHits.has(e.id)) continue;
      const d = Math.hypot(e.x - dp.x, e.y - dp.y);
      if (d < e.radius + dp.radius + 4) {
        dp.pulseHits.add(e.id);
        const px = (e.x - dp.x) / (d || 1);
        const py = (e.y - dp.y) / (d || 1);
        hurtEnemy(world, e, dp.stats.dashPulse * dp.stats.dashDamage, px, py, 320, dp, true);
        spawnParticles(world, e.x, e.y, 10, dp.color, { speed: 260, life: 0.3 });
      }
    }
  }

  world.enemies = world.enemies.filter((e) => e.hp > 0);
}

/**
 * 弹幕发射：每个远程敌人都按招式表出手。
 * Boss 有三阶段时间线，血量跌破阈值就换招；炮台随机挑 4 招轮着打。
 */
function firePattern(world, e, dt, aim) {
  const pt = e.pattern;
  if (!pt) return;
  pt.state.count++;

  if (e.boss) {
    const ratio = e.hp / e.hpMax;
    const timeline = pt.timeline[pt.phase];
    if (timeline && ratio <= timeline.hpAbove) {
      pt.phase = Math.min(pt.timeline.length - 1, pt.phase + 1);
      pt.idx = 0;
      pt.startedAt = world.time;
      ev(world, 'bossPhase', { x: e.x, y: e.y, phase: pt.phase, id: e.id });
    }
    const cur = pt.timeline[pt.phase];
    if (!cur) return;
    const elapsed = world.time - pt.startedAt;
    if (elapsed > cur.patterns[pt.idx]?.until) {
      pt.idx = (pt.idx + 1) % cur.patterns.length;
      pt.startedAt = world.time;
      pt.state.turn += 0.6;
    }
    const pdef = PATTERNS[cur.patterns[pt.idx].i];
    pt.state.patternCd = (pt.state.patternCd ?? 0) - dt;
    if (pt.state.patternCd > 0) return;
    pt.state.patternCd = pdef.cd;
    pdef.fn(world, e, aim, pt.state);
    ev(world, 'enemyShoot', { x: e.x, y: e.y, boss: true });
    return;
  }

  // 炮台：四招轮换，节奏比 Boss 慢
  const pdef = PATTERNS[pt.idx % 4];
  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  e.fireCd = 1.6 + world.rng() * 0.8;
  if (world.rng() < 0.35) pt.idx = (pt.idx + 1) % 4;
  pdef.fn(world, e, aim, pt.state);
  ev(world, 'enemyShoot', { x: e.x, y: e.y });
}

/**
 * 唯一允许改玩家血量的入口（实现在 content.js，避免 sim ↔ upgrades 循环依赖）。
 * 极限模式（noHeal）下任何回复都不生效，只溢出成少量护盾。
 */
export { grantHeal } from './content.js';

function damagePlayer(world, p, amount, fromX, fromY) {
  let dmg = amount * p.stats.damageTaken;
  // 反射装甲：先吃护盾，破盾时给一圈反馈
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
    spawnParticles(world, p.x, p.y, 10, '#7ef7c8', { speed: 220, life: 0.3 });
    if (p.shield <= 0) {
      p.shield = 0;
      spawnParticles(world, p.x, p.y, 16, '#7ef7c8', { speed: 320, life: 0.4 });
      ev(world, 'shieldBreak', { id: p.id });
    }
  }
  if (dmg <= 0) return;
  p.hp -= dmg;
  p.iframe = TUNING.reviveIframe * 0.55;
  world.screenShake = Math.max(world.screenShake, TUNING.shakePlayerHit);
  p.vx += (p.x - fromX) * 6;
  p.vy += (p.y - fromY) * 6;
  spawnParticles(world, p.x, p.y, 14, '#ff5a3c', { speed: 240, life: 0.4 });
  ev(world, 'playerHit', { id: p.id, hp: p.hp, damage: dmg });
  if (p.hp <= 0) {
    p.hp = 0;
    p.down = true;
    p.dashT = 0;
    p.respawnT = COOP.respawnDelay;
    world.screenShake = 30;
    spawnParticles(world, p.x, p.y, 60, '#ff5a3c', { speed: 460, life: 0.9, size: 3 });
    ev(world, 'playerDown', { id: p.id, wave: world.wave });
    // 团灭才结束：多人时另一个还能撑，倒下的会在几秒后归队
    if (!alivePlayers(world).length) {
      world.dead = true;
      ev(world, 'allDown', { wave: world.wave, kills: world.stats.kills });
    }
  }
}

function hurtEnemy(world, e, damage, nx, ny, knock, owner = null, isPulse = false) {
  const before = e.hp;
  e.hp -= damage;
  const actual = Math.max(0, Math.min(damage, before)); // 过量伤害不计入统计
  e.hurt = 1;
  if (owner) owner.statsRun.damageDealt += actual;
  if (!isPulse) {
    e.knockX += nx * knock;
    e.knockY += ny * knock;
    world.hitStop = Math.max(world.hitStop, TUNING.hitStop);
  }
  spawnParticles(world, e.x, e.y, 5, e.color, { speed: 220, life: 0.26, dir: Math.atan2(-ny, -nx), spread: 1.8 });
  ev(world, 'hit', { x: e.x, y: e.y, damage, owner: owner?.id ?? 0 });
  if (owner) triggerProc(world, owner, e);
  if (e.hp <= 0) killEnemy(world, e, nx, ny, owner);
}

function killEnemy(world, e, nx, ny, owner = null) {
  world.stats.kills++;
  if (owner) owner.statsRun.kills++;
  world.screenShake = Math.max(world.screenShake, e.type === 'tank' ? 8 : TUNING.shakeKill);
  spawnParticles(world, e.x, e.y, e.type === 'tank' ? 34 : 16, e.color, {
    speed: e.type === 'tank' ? 380 : 260,
    life: 0.55,
    size: e.type === 'tank' ? 3 : 2,
    dir: Math.atan2(ny, nx),
    spread: 2.4,
  });
  ev(world, 'kill', { x: e.x, y: e.y, type: e.type, by: owner?.id ?? 0, kills: world.stats.kills });
  if (owner) {
    // 击杀回血（残骸回收）——极限模式会转成护盾
    const heal = owner.stats.lifeOnKill;
    if (heal > 0) grantHeal(world, owner, heal * 100);
    // 连锁冲刺：杀完就能再冲
    if (owner.stats.dashOnKill > 0) {
      owner.dashCd = Math.max(0, owner.dashCd - owner.stats.dashOnKill);
      if (owner.dashCd === 0) owner.charges = 1 + Math.max(0, owner.stats.dashCharges);
    }
  }
}

/**
 * 特殊攻击：每次攻击命中时有 0.1% 概率触发"超载回满"。
 * 触发时玩家状态全部拉满（血量/护盾/热量/冲刺），并放出一段红黑特效。
 */
export function triggerProc(world, p, source = null) {
  const rate = world.procRate ?? TUNING.jackpotChance;
  if (rate <= 0 || p.down) return false;
  if (world.rng() >= rate) return false;

  // 极限模式：连大奖都不给血（"不能回血"是硬规则），改为满护盾 + 超长无敌
  // 标准模式：大奖 = 状态全部拉满
  p.heat = 0;
  p.heatLock = false;
  p.charges = 1 + Math.max(0, p.stats.dashCharges);
  p.dashCd = 0;
  if (!world.noHeal) p.hp = p.stats.hpMax;
  p.iframe = Math.max(p.iframe, 1.6);
  p.jackpots++;
  // 护盾给满（先抬容量再给盾，否则会被 shieldMax=0 卡住）
  p.stats.shieldMax = Math.max(p.stats.shieldMax, 24);
  p.shield = p.stats.shieldMax;
  if (world.noHeal) {
    p.stats.shieldMax = Math.max(p.stats.shieldMax, EXTREME.overflowShieldCap);
    p.shield = EXTREME.overflowShieldCap;
    p.iframe = Math.max(p.iframe, 3);
  }

  world.jackpot = { life: TUNING.jackpotDuration, x: source?.x ?? p.x, y: source?.y ?? p.y, id: p.id };
  world.screenShake = Math.max(world.screenShake, 16);
  world.hitStop = Math.max(world.hitStop, 0.12);
  spawnParticles(world, p.x, p.y, 44, '#ff2b4a', { speed: 420, life: 0.8, size: 3 });
  spawnParticles(world, p.x, p.y, 22, '#120008', { speed: 260, life: 0.9, size: 4 });
  ev(world, 'jackpot', { id: p.id, x: p.x, y: p.y, count: p.jackpots });
  return true;
}

/** 熔核尾迹：冲刺路径上留下一段持续伤害区 */
function updateTrails(world, dt) {
  if (!world.trails.length) return;
  for (const tr of world.trails) {
    tr.life -= dt;
    for (const [id, t] of tr.cd) if (t > 0) tr.cd.set(id, t - dt);
    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - tr.x, e.y - tr.y);
      if (d > tr.r + e.radius) continue;
      if ((tr.cd.get(e.id) ?? 0) > 0) continue;
      tr.cd.set(e.id, 0.25);
      const owner = world.players.find((p) => p.id === tr.owner) ?? null;
      hurtEnemy(world, e, tr.dps * 0.25, 0, 0, 0, owner, true);
    }
  }
  world.trails = world.trails.filter((t) => t.life > 0);
}

function updateBullets(world, dt) {
  const { w, h } = world.arena;
  for (const b of world.bullets) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 弹墙
    let bounced = false;
    if (b.x < b.r || b.x > w - b.r) {
      if (b.ricochet > 0) {
        b.ricochet--;
        b.vx *= -1;
        b.x = clamp(b.x, b.r, w - b.r);
        bounced = true;
      } else b.life = 0;
    }
    if (b.y < b.r || b.y > h - b.r) {
      if (b.ricochet > 0) {
        b.ricochet--;
        b.vy *= -1;
        b.y = clamp(b.y, b.r, h - b.r);
        bounced = true;
      } else b.life = 0;
    }
    if (bounced) {
      b.hit = new Set();
      spawnParticles(world, b.x, b.y, 4, '#bff9ff', { speed: 140, life: 0.2 });
    }

    if (b.life <= 0) continue;

    for (const e of world.enemies) {
      if (e.hp <= 0 || b.hit.has(e.id)) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.radius + b.r;
      if (dx * dx + dy * dy <= rr * rr) {
        b.hit.add(e.id);
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const owner = playerOf(world, b);
        if (owner) owner.statsRun.hits++;
        hurtEnemy(world, e, b.damage, b.vx / sp, b.vy / sp, b.knock, owner);
        if (b.pierce > 0) b.pierce--;
        else b.life = 0;
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => b.life > 0);

  // 强制排热脉冲
  if (world.pulses.length) {
    for (const pulse of world.pulses) {
      pulse.life -= dt;
      pulse.r = pulse.maxR * (1 - Math.max(0, pulse.life) / 0.32);
      const owner = world.players.find((p) => p.id === pulse.owner) ?? null;
      for (const e of world.enemies) {
        if (e.hp <= 0 || pulse.hits.has(e.id)) continue;
        const d = Math.hypot(e.x - pulse.x, e.y - pulse.y);
        if (d < pulse.r + e.radius) {
          pulse.hits.add(e.id);
          const nx = (e.x - pulse.x) / (d || 1);
          const ny = (e.y - pulse.y) / (d || 1);
          hurtEnemy(world, e, pulse.damage, nx, ny, 420, owner, true);
        }
      }
    }
    world.pulses = world.pulses.filter((p) => p.life > 0);
  }
}

function updateEnemyBullets(world, dt) {
  const { w, h } = world.arena;
  for (const b of world.eBullets) {
    b.life -= dt;
    b.age = (b.age ?? 0) + dt;
    // 追踪弹：慢慢转向最近的玩家，逼你走位而不是原地微调
    if (b.homing) {
      let best = null;
      let bestD = Infinity;
      for (const p of world.players) {
        if (p.down) continue;
        const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && b.age < 2.2) {
        const want = Math.atan2(best.y - b.y, best.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let diff = want - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const turn = clamp(diff, -b.homing * dt, b.homing * dt);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(cur + turn) * sp;
        b.vy = Math.sin(cur + turn) * sp;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -30 || b.x > w + 30 || b.y < -30 || b.y > h + 30) b.life = 0;

    for (const p of world.players) {
      if (p.down) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (p.iframe <= 0) {
        const rr = p.radius + b.r;
        if (d2 <= rr * rr) {
          b.life = 0;
          damagePlayer(world, p, b.damage, b.x, b.y);
          break;
        }
      }
      // 擦弹：贴着子弹走有收益（东方那套）
      if (!b.grazed && d2 <= (GRAZE.radius + b.r) ** 2) {
        b.grazed = true;
        p.graze += GRAZE.perBullet;
        p.grazeCharge += GRAZE.perBullet;
        p.grazeFlash = 0.3;
        ev(world, 'graze', { id: p.id, x: b.x, y: b.y });
        if (p.grazeCharge >= GRAZE.chargeNeeded) {
          p.grazeCharge = 0;
          p.charges = Math.min(1 + Math.max(0, p.stats.dashCharges), p.charges + 1);
          // 擦弹给的护盾自带容量：不依赖"反射装甲"那张卡
          p.stats.shieldMax = Math.max(p.stats.shieldMax, 12);
          p.shield = Math.min(p.stats.shieldMax, p.shield + 12);
          p.iframe = Math.max(p.iframe, 0.35);
          ev(world, 'grazeBonus', { id: p.id, x: p.x, y: p.y });
        }
      }
    }
  }
  world.eBullets = world.eBullets.filter((b) => b.life > 0);
}

function updateParticles(world, dt) {
  for (const q of world.particles) {
    q.life -= dt;
    const k = Math.exp(-q.slow * dt);
    q.vx *= k;
    q.vy *= k;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
  }
  if (world.particles.length) world.particles = world.particles.filter((q) => q.life > 0);
}

/** 某个玩家点了一张卡。传 playerId 时只允许选"发给自己的那三张"（测试/工具可传 allowAny） */
export function chooseCard(world, id, playerId = null, { allowAny = false } = {}) {
  const p = playerId === null ? world.players[0] : world.players.find((x) => x.id === playerId);
  const card = CARDS.find((c) => c.id === id);
  if (!p || !card) return false;
  if (playerId !== null || !allowAny) {
    if (p.down) return false;
    if (!allowAny && !world.cardChoices[p.index]?.includes(id)) return false;
  }
  if (!allowAny) world.cardChoices[p.index] = [];
  card.apply(p.stats, world, p);
  p.stats.taken.push(id);
  // 上限型强化（复合装甲）加上限后就该补满，不算"回血"
  p.hp = Math.min(p.stats.hpMax, p.hp);
  // 二段推进这类"上限型"强化：立刻把充能补满，拿到就能用
  p.charges = Math.max(p.charges, 1 + Math.max(0, p.stats.dashCharges));

  ev(world, 'cardPicked', { id, player: p.id });
  // 所有人都选完（或都倒了）才回到战斗
  if (world.cardChoices.every((list) => list.length === 0)) world.phase = 'play';
  return true;
}

/** 跳过还没选的人（用于单人遗留/超时/玩家倒地） */
export function skipRemainingCards(world) {
  world.cardChoices = world.cardChoices.map(() => []);
  world.phase = 'play';
}

/** 波次清空时：让倒地的玩家提前归队（双人模式的"救援"机制） */
export function reviveDowned(world, hpRatio = COOP.reviveHpRatio) {
  const revived = [];
  for (const p of world.players) {
    if (!p.down) continue;
    p.down = false;
    p.respawnT = 0;
    p.hp = Math.max(1, p.stats.hpMax * hpRatio);
    p.iframe = TUNING.reviveIframe;
    p.heat = 0;
    p.heatLock = false;
    p.charges = 1 + Math.max(0, p.stats.dashCharges);
    revived.push(p.id);
    ev(world, 'playerRevived', { id: p.id, spawn: false });
  }
  return revived;
}

export function accuracy(world) {
  let shots = 0;
  let hits = 0;
  for (const p of world.players) {
    shots += p.statsRun.shots;
    hits += p.statsRun.hits;
  }
  if (!shots) return 0;
  // 穿透/弹射会让同一发子弹命中多次，统计上封顶 100%
  return Math.min(1, hits / shots);
}

export function playerAccuracy(p) {
  if (!p.statsRun.shots) return 0;
  return Math.min(1, p.statsRun.hits / p.statsRun.shots);
}
