// 弹幕玩法（雷霆战机 / 东方那套）的回归测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, GRAZE, STEP } from '../src/content.js';
import { activeBoss, createWorld, makeInput, p1, step, waveComposition } from '../src/sim.js';
import { PATTERNS, bossPhases, fan, ring } from '../src/patterns.js';
import { runHeadless } from '../src/harness.js';

const blank = makeInput();

/** 只为弹幕测试准备一个干净场地：清掉普通敌人，只留我们要观察的东西 */
function clearField(world) {
  world.enemies.length = 0;
  world.spawnQueue.length = 0;
  world.eBullets.length = 0;
}

const stubBoss = (world, x = 480, y = 120) => {
  world.enemies.push({
    id: 5555,
    type: 'boss',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 34,
    hp: 99999,
    hpMax: 99999,
    speed: 0,
    accel: 0,
    damage: 26,
    color: '#b04dff',
    ranged: true,
    boss: true,
    fireCd: 0,
    patternCd: 0,
    pattern: { phase: 0, timeline: bossPhases(world.wave), idx: 0, startedAt: 0, state: { turn: 0, count: 0, patternCd: 0 } },
    hurt: 0,
    spawnT: 0,
    stunned: 0,
    knockX: 0,
    knockY: 0,
    phase: 0,
    targetId: 0,
  });
  return world.enemies[0];
};

test('弹幕模式库：每招都能独立产弹，且参数合法', () => {
  const w = createWorld(80);
  clearField(w);
  const e = stubBoss(w);
  for (let i = 0; i < PATTERNS.length; i++) {
    w.eBullets.length = 0;
    const before = w.eBullets.length;
    PATTERNS[i].fn(w, e, 0, { turn: 0, count: 0 });
    assert.ok(w.eBullets.length > before, `招式「${PATTERNS[i].name}」没有产生子弹`);
    for (const b of w.eBullets) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `招式「${PATTERNS[i].name}」产生了非法坐标`);
      assert.ok(Number.isFinite(b.vx) && Number.isFinite(b.vy));
      assert.ok(b.damage > 0 && b.r > 0 && b.life > 0);
    }
    assert.ok(PATTERNS[i].cd > 0, `招式「${PATTERNS[i].name}」缺少冷却，会每帧倾泻`);
  }
});

test('ring / fan 的几何形状正确', () => {
  const w = createWorld(81);
  clearField(w);
  ring(w, 100, 100, 8, 0, { speed: 100 });
  assert.equal(w.eBullets.length, 8);
  const angles = w.eBullets.map((b) => Math.atan2(b.vy, b.vx));
  assert.ok(Math.abs(angles[0] - 0) < 1e-6);
  assert.ok(Math.abs(angles[2] - Math.PI / 2) < 1e-6, '第 3 发应该朝正下方');

  w.eBullets.length = 0;
  fan(w, 100, 100, 0, 5, Math.PI / 2, { speed: 100 });
  assert.equal(w.eBullets.length, 5);
  const spread = w.eBullets.map((b) => Math.atan2(b.vy, b.vx));
  assert.ok(Math.abs(spread[0] + Math.PI / 4) < 1e-6, '扇射第一发应该在 -45°');
  assert.ok(Math.abs(spread[4] - Math.PI / 4) < 1e-6, '扇射最后一发应该在 +45°');
});

test('Boss 每 5 波登场，并且必须被打死才算清场', () => {
  assert.ok(waveComposition(5).includes('boss'), '第 5 波应该有 Boss');
  assert.ok(!waveComposition(4).includes('boss'), '第 4 波不该有 Boss');
  assert.ok(waveComposition(10).includes('boss'), '第 10 波应该有 Boss');

  const w = createWorld(82);
  clearField(w);
  stubBoss(w);
  assert.ok(activeBoss(w), '场上应该有 Boss');
  // 场上还有 Boss 时，不该进入清场流程
  for (let i = 0; i < 60 * 3; i++) step(w, blank, STEP);
  assert.equal(w.phase, 'play', 'Boss 没死就不该进入选卡阶段');
  assert.ok(w.stats.waves < w.wave, '不该记录为"已清波"');
});

test('Boss 会持续打出成规模的弹幕，但不会失控', () => {
  const w = createWorld(83, { playerCount: 1 });
  clearField(w);
  p1(w).hp = 1e9;
  p1(w).stats.hpMax = 1e9;
  stubBoss(w);
  let peak = 0;
  for (let i = 0; i < 60 * 20; i++) {
    step(w, blank, STEP);
    peak = Math.max(peak, w.eBullets.length);
    if (p1(w).hp <= 0) {
      p1(w).hp = 1e9; // 测试弹幕规模，不测难度
    }
    assert.ok(w.eBullets.length < 1400, `第 ${i} 帧弹幕数量失控：${w.eBullets.length}`);
  }
  assert.ok(peak > 20, `Boss 应该打出成规模的弹幕，峰值只有 ${peak}`);
});

test('Boss 分阶段：血量跌破阈值会换阶段', () => {
  const w = createWorld(84);
  clearField(w);
  const boss = stubBoss(w);
  assert.equal(boss.pattern.phase, 0);
  boss.hp = boss.hpMax * 0.5; // 跌破 65%
  const seen = [];
  for (let i = 0; i < 60; i++) {
    step(w, blank, STEP);
    if (w.events.some((e) => e.type === 'bossPhase')) seen.push(boss.pattern.phase);
  }
  assert.ok(seen.length > 0, '血量跌破阈值应该切阶段');
  assert.ok(boss.pattern.phase >= 1);
});

test('擦弹：贴身飞过子弹会积攒充能，攒满给奖励', () => {
  const w = createWorld(85);
  clearField(w);
  const p = p1(w);
  p.x = 480;
  p.y = 270;
  // 在机体旁边放一串敌方子弹，让它从身边掠过
  for (let i = 0; i < 8; i++) {
    w.eBullets.push({
      x: 480,
      y: 240 + i * 2,
      vx: 0,
      vy: 30,
      r: 5,
      damage: 1,
      life: 3,
      color: '#ff5c8a',
      age: 0,
    });
  }
  const graze0 = p.graze;
  // 注意：world.events 每帧都会重置，所以要在循环里累积着看
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    step(w, blank, STEP);
    for (const e of w.events) seen.add(e.type);
  }
  assert.ok(p.graze > graze0, `擦弹应该计数：${graze0} → ${p.graze}`);
  assert.equal(p.graze, 8, '8 发子弹各擦一次');
  assert.ok(seen.has('graze'), '应该发出擦弹事件');
  assert.ok(p.grazeCharge > 0, '擦弹应该积攒充能');

  // 铺满充能，验证奖励
  p.charges = 0;
  p.dashCd = 5;
  p.shield = 0;
  p.grazeCharge = GRAZE.chargeNeeded - 0.5;
  w.eBullets.length = 0;
  w.eBullets.push({ x: p.x, y: p.y - 18, vx: 0, vy: 0, r: 5, damage: 1, life: 3, color: '#ff5c8a', age: 0 });
  for (let i = 0; i < 2; i++) step(w, blank, STEP);
  assert.equal(p.charges, 1, '擦弹攒满应该补 1 段冲刺充能');
  assert.ok(p.shield > 0, '擦弹攒满应该给护盾');
  assert.ok(p.iframe > 0.3, '擦弹攒满应该给一小段无敌');
});

test('擦弹不会误判成命中，也不会漏判命中', () => {
  const w = createWorld(86);
  clearField(w);
  const p = p1(w);
  p.x = 480;
  p.y = 270;
  p.iframe = 0;
  const hp0 = p.hp;
  // 正中机体的子弹必须扣血，而不是只算擦弹
  w.eBullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 5, damage: 10, life: 3, color: '#ff5c8a', age: 0 });
  step(w, blank, STEP);
  assert.ok(p.hp < hp0, '正中机体的子弹必须造成伤害');
});

test('擦弹充能会随时间衰减（不能一直靠老弹幕吃奖励）', () => {
  const w = createWorld(87);
  clearField(w);
  const p = p1(w);
  p.grazeCharge = 30;
  for (let i = 0; i < 60 * 4; i++) step(w, blank, STEP);
  assert.ok(p.grazeCharge < 30, '不擦弹的话充能应该衰减');
});

test('弹幕 AI 长跑：双人面对 Boss 不会崩、不会刷爆内存', () => {
  let maxEBullets = 0;
  let finalWorld = null;
  const { metrics } = runHeadless({
    frames: 60 * 240,
    seed: 88,
    playerCount: 2,
    revive: true,
    onFrame: (world) => {
      finalWorld = world;
      maxEBullets = Math.max(maxEBullets, world.eBullets.length);
      for (const p of world.players) {
        assert.ok(Number.isFinite(p.graze) && p.graze >= 0, '擦弹计数应该合法');
        assert.ok(p.x >= 0 && p.x <= ARENA.w, '玩家不该越界');
      }
      assert.ok(world.eBullets.length < 1400, `弹幕数量失控：${world.eBullets.length}`);
    },
  });
  const graze = finalWorld.players.map((p) => p.graze);
  console.log(
    `  [弹幕] 双人 4 分钟：波次=${metrics.wave} 击杀=${metrics.kills} 弹幕峰值=${maxEBullets} 擦弹=${graze.join('/')}`
  );
  assert.ok(metrics.kills > 100, `弹幕模式下也该打得动：${metrics.kills}`);
  assert.ok(maxEBullets > 30, '整局都没见到成规模弹幕，说明 Boss 没打出来');
  assert.ok(graze.some((g) => g > 0), 'AI 贴身缠斗时应该产生擦弹');
});
