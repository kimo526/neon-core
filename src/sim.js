// NEON CORE — 纯逻辑模拟层。
// 这一层完全不碰 DOM：可以在浏览器里跑，也可以在 node 里以 60Hz 无头跑几千帧做平衡测试。
import { ARENA, ENEMY_SCALING, ENEMY_TYPES, TUNING, PLAYER, WEAPONS } from './content.js';
import { CARDS, createStats, rollCards } from './upgrades.js';

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

export const makeInput = () => ({
  moveX: 0,
  moveY: 0,
  aimX: ARENA.w * 0.5,
  aimY: 0,
  firing: false,
  dash: false,
});

export function createWorld(seed = 1) {
  const rng = makeRng(seed);
  const stats = createStats();
  const world = {
    seed,
    rng,
    time: 0,
    arena: { ...ARENA },
    player: makePlayer(stats),
    bullets: [],
    eBullets: [],
    enemies: [],
    particles: [],
    pulses: [],
    texts: [],
    spawnQueue: [],
    wave: 1,
    phase: 'play',
    cardChoices: [],
    paused: false,
    timeScale: 1,
    screenShake: 0,
    hitStop: 0,
    muzzle: 0,
    heatLock: false,
    dead: false,
    stats: { kills: 0, shots: 0, hits: 0, waves: 0, timeAlive: 0 },
    events: [],
    _id: 0,
  };
  spawnWave(world, 1);
  return world;
}

function makePlayer(stats) {
  return {
    x: ARENA.w * 0.5,
    y: ARENA.h * 0.5,
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
    iframe: 0,
    pulseHits: null,
    trail: [],
  };
}

const ev = (world, type, data) => world.events.push({ type, ...data });

/** 按波次生成敌人配比（纯函数，方便测试"第 20 波到底出什么"） */
export function waveComposition(wave) {
  const list = [];
  const add = (type, count) => {
    for (let i = 0; i < count; i++) list.push(type);
  };
  add('drone', 3 + Math.floor(wave * 1.3));
  if (wave >= 2) add('runner', 1 + Math.floor((wave - 1) * 0.7));
  if (wave >= 4) add('tank', 1 + Math.floor((wave - 4) / 2));
  if (wave >= 3) add('turret', Math.floor(wave / 3));
  return list;
}

function scaleFor(wave) {
  const k = wave - 1;
  return {
    hp: Math.pow(ENEMY_SCALING.hp, k),
    speed: Math.pow(ENEMY_SCALING.speed, k),
    damage: Math.pow(ENEMY_SCALING.damage, k),
  };
}

export function spawnWave(world, wave) {
  const comp = waveComposition(wave);
  const scale = scaleFor(wave);
  const lead = 0.65;
  world.spawnQueue = comp.map((type, i) => ({ type, at: lead + i * 0.28, scale }));
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
  const hp = def.hp * scale.hp;
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
    speed: def.speed * scale.speed,
    accel: def.accel,
    damage: def.damage * scale.damage,
    color: def.color,
    ranged: !!def.ranged,
    fireCd: def.ranged ? 1.2 + world.rng() * 0.8 : 0,
    hurt: 0,
    spawnT: 0.45,
    knockX: 0,
    knockY: 0,
    phase: world.rng() * TAU,
    lifeOnHit: def.lifeOnHit ?? 0.02,
  });
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

/** 主更新：世界每帧只依赖 (world, input, dt)，没有隐藏的全局状态 */
export function step(world, input, dt) {
  if (dt <= 0) return world;
  world.events = [];
  if (world.dead) return world;

  // 命中定格：让打击有"顿挫感"
  let scale = 1;
  if (world.hitStop > 0) {
    world.hitStop = Math.max(0, world.hitStop - dt);
    scale = 0.18;
  }
  const sdt = dt * scale * world.timeScale;
  world.time += sdt;

  updateSpawns(world, sdt);
  updatePlayer(world, input, sdt);
  updateEnemies(world, sdt);
  updateBullets(world, sdt);
  updateEnemyBullets(world, sdt);
  updateParticles(world, sdt);
  updateWave(world, sdt);

  world.screenShake = Math.max(0, world.screenShake - dt * 42);
  world.muzzle = Math.max(0, world.muzzle - dt * 8);
  if (!world.dead) world.stats.timeAlive += sdt;
  return world;
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
  if (world.spawnQueue.length || world.enemies.length) return;
  world.waveClearT = (world.waveClearT ?? 0) + dt;
  if (world.waveClearT < TUNING.waveClearDelay) return;
  world.waveClearT = 0;
  world.stats.waves = world.wave;
  ev(world, 'waveClear', { wave: world.wave });

  const next = world.wave + 1;
  if (world.wave % 2 === 1) {
    world.phase = 'upgrade';
    world.cardChoices = rollCards(world.rng, TUNING.cardCount).map((c) => c.id);
    ev(world, 'upgradeOffered', { wave: world.wave });
  }
  world.wave = next;
  spawnWave(world, next);
}

function updatePlayer(world, input, dt) {
  const p = world.player;
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
    world.heatLock = false;
  }

  if (input.aimX !== undefined) {
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
    const accel = st.accel;
    p.vx += mx * accel * dt;
    p.vy += my * accel * dt;
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
    p.pulseHits = st.dashPulse ? new Set() : null;
    ev(world, 'dash', { x: p.x, y: p.y, dir, charges: p.charges });
    spawnParticles(world, p.x, p.y, 8, '#8affc1', { speed: 200, life: 0.3, dir: dir + Math.PI, spread: 1.2 });
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

  // 开火 + 热量：按住扳机就完全不散热，想降温必须松手（这是这个游戏的核心节奏）
  p.fireCd -= dt;
  const heatMul = st.anchor ? (moving ? 0.7 : 2.4) : 1;
  const cooling = (st.heatCool * (world.heatLock ? TUNING.overheatCoolMul : 1)) * heatMul;
  const wantFire = !!input.firing && !world.dead;
  if (!wantFire && p.heat > 0) {
    p.heat = Math.max(0, p.heat - cooling * dt);
  }
  // 过热锁：降到 release 比例就解锁，避免"罚站 3 秒多"
  if (world.heatLock && p.heat <= st.heatMax * TUNING.heatRelease) {
    world.heatLock = false;
    ev(world, 'cooledDown', { heat: p.heat });
  }
  if (wantFire && !world.heatLock && p.fireCd <= 0 && p.dashT <= 0) {
    fire(world, p, st);
  }

  // 回复
  if (st.regen > 0) p.hp = Math.min(st.hpMax, p.hp + st.regen * dt);
}

function fire(world, p, st) {
  const w = st.weapon;
  p.fireCd = st.fireRate;
  p.heat = Math.min(st.heatMax, p.heat + st.heatPerShot);
  world.stats.shots += st.pellets;
  world.muzzle = 1;

  const thermo = 1 + (st.thermo * clamp(p.heat / st.heatMax, 0, 1));
  const dmg = st.damage * thermo;
  const muzzleX = p.x + Math.cos(p.aim) * (p.radius + 4);
  const muzzleY = p.y + Math.sin(p.aim) * (p.radius + 4);

  for (let i = 0; i < st.pellets; i++) {
    const jitter = st.pellets > 1 ? (world.rng() - 0.5) * st.spread : (world.rng() - 0.5) * st.spread * 0.6;
    const a = p.aim + jitter;
    world.bullets.push({
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(a) * st.bulletSpeed,
      vy: Math.sin(a) * st.bulletSpeed,
      r: st.bulletRadius,
      damage: dmg,
      life: st.bulletLife,
      pierce: st.pierce,
      ricochet: st.ricochet,
      knock: st.bulletKnockback,
      hit: new Set(),
      color: w === 'heavy' ? '#ffd166' : '#8ff6ff',
    });
  }
  spawnParticles(world, muzzleX, muzzleY, st.pellets > 1 ? 8 : 4, '#bff9ff', {
    speed: 260,
    life: 0.18,
    size: 1.6,
    dir: p.aim,
    spread: 0.9,
  });
  ev(world, 'shoot', { x: muzzleX, y: muzzleY, pellets: st.pellets });

  if (p.heat >= st.heatMax) {
    world.heatLock = true;
    ev(world, 'overheat', { x: p.x, y: p.y });
    if (st.ventBlast) {
      spawnParticles(world, p.x, p.y, 26, '#ff5a3c', { speed: 380, life: 0.5, size: 2.4 });
      world.pulses.push({ x: p.x, y: p.y, r: 8, maxR: 130, life: 0.32, damage: 26, hits: new Set() });
    }
  }
}

function updateEnemies(world, dt) {
  const p = world.player;
  for (const e of world.enemies) {
    e.hurt = Math.max(0, e.hurt - dt * 4);
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      continue;
    }

    // 击退
    e.x += e.knockX * dt;
    e.y += e.knockY * dt;
    const kd = Math.exp(-8 * dt);
    e.knockX *= kd;
    e.knockY *= kd;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
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

    // 分离：同类型互相推开，避免完全重叠（也让玩家的穿透弹更值钱）
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

    // 远程敌人：保持距离点射
    if (e.ranged) {
      e.fireCd -= dt;
      const want = 220;
      const toward = dist > want + 30 ? 1 : dist < want - 30 ? -1 : 0;
      e.x += nx * toward * 40 * dt;
      e.y += ny * toward * 40 * dt;
      if (e.fireCd <= 0 && dist < 520) {
        e.fireCd = 1.5 + world.rng() * 0.7;
        const spread = 0.05;
        const a = Math.atan2(dy, dx) + (world.rng() - 0.5) * spread;
        world.eBullets.push({
          x: e.x + Math.cos(a) * (e.radius + 3),
          y: e.y + Math.sin(a) * (e.radius + 3),
          vx: Math.cos(a) * 300,
          vy: Math.sin(a) * 300,
          r: 4,
          damage: e.damage,
          life: 3,
          color: '#ff9ad4',
        });
        ev(world, 'enemyShoot', { x: e.x, y: e.y });
      }
    }

    // 接触伤害
    if (dist < e.radius + p.radius) {
      if (p.iframe <= 0) {
        damagePlayer(world, e.damage, e.x, e.y);
        e.knockX -= nx * 260;
        e.knockY -= ny * 260;
      }
    }

    // 冲刺脉冲
    if (p.dashT > 0 && p.pulseHits && !p.pulseHits.has(e.id) && dist < e.radius + p.radius + 4) {
      p.pulseHits.add(e.id);
      hurtEnemy(world, e, 26, nx, ny, 320, true);
      spawnParticles(world, e.x, e.y, 10, '#8affc1', { speed: 260, life: 0.3 });
    }
  }

  world.enemies = world.enemies.filter((e) => e.hp > 0);
}

function damagePlayer(world, amount, fromX, fromY) {
  const p = world.player;
  const dmg = amount * p.stats.damageTaken;
  p.hp -= dmg;
  p.iframe = TUNING.reviveIframe * 0.55;
  world.screenShake = Math.max(world.screenShake, TUNING.shakePlayerHit);
  p.vx += (p.x - fromX) * 6;
  p.vy += (p.y - fromY) * 6;
  spawnParticles(world, p.x, p.y, 14, '#ff5a3c', { speed: 240, life: 0.4 });
  ev(world, 'playerHit', { hp: p.hp, damage: dmg });
  if (p.hp <= 0) {
    p.hp = 0;
    world.dead = true;
    world.screenShake = 30;
    spawnParticles(world, p.x, p.y, 60, '#ff5a3c', { speed: 460, life: 0.9, size: 3 });
    ev(world, 'playerDead', { wave: world.wave, kills: world.stats.kills });
  }
}

function hurtEnemy(world, e, damage, nx, ny, knock, isPulse = false) {
  e.hp -= damage;
  e.hurt = 1;
  if (!isPulse) {
    e.knockX += nx * knock;
    e.knockY += ny * knock;
    world.hitStop = Math.max(world.hitStop, TUNING.hitStop);
  }
  spawnParticles(world, e.x, e.y, 5, e.color, { speed: 220, life: 0.26, dir: Math.atan2(-ny, -nx), spread: 1.8 });
  ev(world, 'hit', { x: e.x, y: e.y, damage });
  if (e.hp <= 0) {
    killEnemy(world, e, nx, ny);
  }
}

function killEnemy(world, e, nx, ny) {
  world.stats.kills++;
  world.screenShake = Math.max(world.screenShake, e.type === 'tank' ? 8 : TUNING.shakeKill);
  spawnParticles(world, e.x, e.y, e.type === 'tank' ? 34 : 16, e.color, {
    speed: e.type === 'tank' ? 380 : 260,
    life: 0.55,
    size: e.type === 'tank' ? 3 : 2,
    dir: Math.atan2(ny, nx),
    spread: 2.4,
  });
  const heal = world.player.stats.lifeOnKill;
  if (heal > 0) world.player.hp = Math.min(world.player.stats.hpMax, world.player.hp + heal * 100);
  ev(world, 'kill', { x: e.x, y: e.y, type: e.type, kills: world.stats.kills });
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
        world.stats.hits++;
        hurtEnemy(world, e, b.damage, b.vx / sp, b.vy / sp, b.knock);
        if (b.pierce > 0) b.pierce--;
        else b.life = 0;
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => b.life > 0);

  // 脉冲（强制排热）
  if (world.pulses.length) {
    for (const pulse of world.pulses) {
      pulse.life -= dt;
      pulse.r = pulse.maxR * (1 - Math.max(0, pulse.life) / 0.32);
      for (const e of world.enemies) {
        if (e.hp <= 0 || pulse.hits.has(e.id)) continue;
        const d = Math.hypot(e.x - pulse.x, e.y - pulse.y);
        if (d < pulse.r + e.radius) {
          pulse.hits.add(e.id);
          const nx = (e.x - pulse.x) / (d || 1);
          const ny = (e.y - pulse.y) / (d || 1);
          hurtEnemy(world, e, pulse.damage, nx, ny, 420, true);
        }
      }
    }
    world.pulses = world.pulses.filter((p) => p.life > 0);
  }
}

function updateEnemyBullets(world, dt) {
  const p = world.player;
  const { w, h } = world.arena;
  for (const b of world.eBullets) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -20 || b.x > w + 20 || b.y < -20 || b.y > h + 20) b.life = 0;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const rr = p.radius + b.r;
    if (dx * dx + dy * dy <= rr * rr && p.iframe <= 0) {
      b.life = 0;
      damagePlayer(world, b.damage, b.x, b.y);
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

/** 玩家点了一张卡 */
export function chooseCard(world, id) {
  const card = CARDS.find((c) => c.id === id);
  if (!card) return false;
  card.apply(world.player.stats, world);
  world.player.stats.taken.push(id);
  world.player.hp = Math.min(world.player.stats.hpMax, world.player.hp);
  // 二段推进这类"上限型"强化：立刻把充能补满，拿到就能用
  const maxCharges = 1 + Math.max(0, world.player.stats.dashCharges);
  world.player.charges = Math.max(world.player.charges, maxCharges);
  world.phase = 'play';
  world.cardChoices = [];
  ev(world, 'cardPicked', { id });
  return true;
}

export function accuracy(world) {
  if (!world.stats.shots) return 0;
  return world.stats.hits / world.stats.shots;
}
