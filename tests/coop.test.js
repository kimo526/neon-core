// 本地双人（合作）机制的回归测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, COOP, STEP, TUNING } from '../src/content.js';
import { createWorld, makeInput, skipRemainingCards, step, waveComposition } from '../src/sim.js';
import { CARDS } from '../src/upgrades.js';
import { runHeadless } from '../src/harness.js';

const blank = [makeInput(), makeInput()];

/** 把一个敌人放到指定坐标并冻结它，方便做定点测试 */
const stubEnemy = (world, x, y, over = {}) => {
  world.enemies.length = 0;
  world.spawnQueue.length = 0;
  world.enemies.push({
    id: 7777,
    type: 'drone',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 11,
    hp: 9999,
    hpMax: 9999,
    speed: 0,
    accel: 0,
    damage: 0,
    color: '#fff',
    ranged: false,
    fireCd: 0,
    hurt: 0,
    spawnT: 0,
    knockX: 0,
    knockY: 0,
    phase: 0,
    targetId: 0,
    ...over,
  });
  return world.enemies[0];
};

test('双人世界：两名玩家各自独立（位置/血量/热量/武器）', () => {
  const w = createWorld(1, { playerCount: 2 });
  assert.equal(w.players.length, 2);
  assert.equal(w.coopBonus, COOP.enemyBonus);
  const [a, b] = w.players;
  assert.notEqual(a.x, b.x, '两人不该叠在一起出生');
  assert.notEqual(a.color, b.color, '两人颜色要能分清');

  // 只有 P1 一直开火：热量应该只涨在 P1 身上
  const inputs = [
    { ...makeInput(ARENA.w / 2, 0), firing: true },
    { ...makeInput(ARENA.w / 2, ARENA.h), firing: false },
  ];
  for (let i = 0; i < 40; i++) step(w, inputs, STEP);
  assert.ok(a.heat > 0, `P1 应该积热，实际 ${a.heat}`);
  assert.equal(b.heat, 0, 'P2 没开枪就不该有热量');

  // 只有 P2 按方向键移动：位移只发生在 P2 身上
  const bx = b.x;
  const ax = a.x;
  for (let i = 0; i < 30; i++) step(w, [makeInput(), { ...makeInput(), moveX: -1 }], STEP);
  assert.ok(b.x < bx, 'P2 应该往左走');
  assert.ok(Math.abs(a.x - ax) < 40, 'P1 不该被 P2 的输入带着走');
});

test('双人：武器互不干扰', () => {
  const w = createWorld(2, { playerCount: 2 });
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  step(w, [{ ...makeInput(), weaponId: 'heavy' }, { ...makeInput(), weaponId: 'ranger' }], STEP);
  assert.equal(w.players[0].stats.weapon, 'heavy');
  assert.equal(w.players[1].stats.weapon, 'ranger');
});

test('双人：敌人锁定最近的玩家，且不会无故换目标', () => {
  const w = createWorld(3, { playerCount: 2 });
  w.players[0].x = 200;
  w.players[0].y = 270;
  w.players[1].x = 800;
  w.players[1].y = 270;
  const e = stubEnemy(w, 760, 270, { speed: 120, accel: 600 });
  step(w, blank, STEP);
  assert.equal(e.targetId, 2, '离 P2 近就该打 P2');

  // P2 跑到远处、P1 留在原地：已经锁定的目标不该立刻改（攻击要有连贯性）
  w.players[1].x = 900;
  step(w, blank, STEP);
  assert.equal(e.targetId, 2, '目标还在就不该秒切');

  // 目标倒地后立刻改打另一个
  w.players[1].down = true;
  step(w, blank, STEP);
  assert.equal(e.targetId, 1, '目标倒了应该改打另一个玩家');
});

test('双人：子弹不会打到自己人（没有友伤）', () => {
  const w = createWorld(4, { playerCount: 2 });
  w.players[0].x = 300;
  w.players[0].y = 270;
  w.players[1].x = 500;
  w.players[1].y = 270;
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  const hp2 = w.players[1].hp;
  const inputs = [{ ...makeInput(900, 270), firing: true }, makeInput()];
  // P1 朝右打，P2 正好站在弹道上
  for (let i = 0; i < 90; i++) step(w, inputs, STEP);
  assert.equal(w.players[1].hp, hp2, '队友不该被自己的子弹打到');
  assert.ok(w.players[0].statsRun.shots > 0, 'P1 应该开了枪');
});

test('双人：伤害/击杀/命中率分开记账', () => {
  const w = createWorld(5, { playerCount: 2 });
  stubEnemy(w, 500, 100, { hp: 30 });
  w.players[0].x = 500;
  w.players[0].y = 300;
  const inputs = [{ ...makeInput(500, 100), firing: true }, makeInput()];
  for (let i = 0; i < 120 && w.enemies.length; i++) step(w, inputs, STEP);
  assert.equal(w.stats.kills, 1);
  assert.equal(w.players[0].statsRun.kills, 1, '击杀算在开枪的人头上');
  assert.equal(w.players[1].statsRun.kills, 0);
  assert.ok(w.players[0].statsRun.damageDealt > 0);
  assert.equal(w.players[1].statsRun.damageDealt, 0);
});

test('双人：每人各拿三张卡，都选完才继续', () => {
  const w = createWorld(6, { playerCount: 2 });
  w.spawnQueue.length = 0;
  w.enemies.length = 0;
  for (let i = 0; i < 60 * 3 && w.phase !== 'upgrade'; i++) step(w, blank, STEP);
  assert.equal(w.phase, 'upgrade');
  assert.equal(w.cardChoices.length, 2);
  for (const list of w.cardChoices) assert.equal(list.length, TUNING.cardCount);
  assert.notDeepEqual(w.cardChoices[0], w.cardChoices[1], '两个人抽到的卡组应该是各自独立的');

  assert.equal(w.phase, 'upgrade', '第一个人选完还要等第二个人');
  assert.equal(w.phase, 'upgrade');
  const [c1] = w.cardChoices[0];
  assert.equal(CARDS.some((c) => c.id === c1), true);
  assert.equal(w.players[0].stats.taken.length, 0);
});

test('双人：倒地的队友 5 秒后归队，两人都倒才算团灭', () => {
  const w = createWorld(7, { playerCount: 2 });
  w.spawnQueue.length = 0;
  w.enemies.length = 0;

  // 把 P2 打到倒地
  const p2 = w.players[1];
  p2.hp = 1;
  p2.iframe = 0;
  stubEnemy(w, p2.x, p2.y, { radius: 21, damage: 99 });
  for (let i = 0; i < 5 && !p2.down; i++) step(w, blank, STEP);
  assert.equal(p2.down, true, 'P2 应该被打倒');
  assert.equal(w.dead, false, '还有一个人站着就不算团灭');

  // 倒下期间不再吃伤害、也不参与战斗
  const hpAfter = p2.hp;
  stubEnemy(w, p2.x, p2.y, { radius: 21, damage: 99 });
  for (let i = 0; i < 30; i++) step(w, blank, STEP);
  assert.equal(p2.hp, hpAfter, '倒地的人不该继续掉血');

  // 等归队
  for (let i = 0; i < 60 * (COOP.respawnDelay + 1) && p2.down; i++) step(w, blank, STEP);
  assert.equal(p2.down, false, '几秒后应该归队');
  assert.ok(p2.hp > 0 && p2.iframe > 0, '归队时应该带无敌帧');

  // 两人同时倒 → 团灭（在两人身上各放一个"必杀"敌人）
  w.enemies.length = 0;
  w.dead = false;
  for (const p of w.players) {
    p.hp = 1;
    p.iframe = 0;
  }
  const killers = [];
  for (const p of w.players) {
    stubEnemy(w, p.x, p.y, { id: 900 + p.id, radius: 40, damage: 999, speed: 0 });
    killers.push({ ...w.enemies[0], id: 950 + p.id });
  }
  w.enemies.push(...killers);
  for (let i = 0; i < 5 && !w.dead; i++) step(w, blank, STEP);
  assert.equal(w.dead, true, `两人都倒下就该结束（现在 hp=${w.players.map((p) => Math.round(p.hp))} down=${w.players.map((p) => p.down)}）`);

  // 双人模式不该卡在选卡阶段
  const w2 = createWorld(8, { playerCount: 2 });
  w2.phase = 'upgrade';
  w2.cardChoices = [['thruster'], []];
  skipRemainingCards(w2);
  assert.equal(w2.phase, 'play');
});

test('双人难度确实更高：敌人更多、血更厚', () => {
  const solo = waveComposition(5, 1);
  const coop = waveComposition(5, COOP.enemyBonus);
  assert.ok(coop.length > solo.length * 1.4, `双人敌人应该明显更多：${solo.length} → ${coop.length}`);

  const w = createWorld(9, { playerCount: 2 });
  w.spawnQueue.length = 0;
  w.enemies.length = 0;
  w.wave = 5;
  w.spawnQueue = coop.map((type, i) => ({
    type,
    at: 0.001 * i,
    scale: { hp: Math.pow(1.14, 4) * (1 + (COOP.enemyBonus - 1) * COOP.hpSharing), speed: Math.pow(1.025, 4), damage: Math.pow(1.055, 4) },
  }));
  w.time = 10;
  for (let i = 0; i < 5; i++) step(w, blank, STEP);
  const drone = w.enemies.find((e) => e.type === 'drone');
  assert.ok(drone, '第 5 波该有 drone');
  assert.ok(drone.hpMax > 24 * Math.pow(1.14, 4), `双人血量应该有额外加成，实际 ${drone.hpMax}`);
});

test('双人 AI 跑得动：两人都能输出，且不会有人一直躺', () => {
  const { metrics } = runHeadless({ frames: 60 * 120, seed: 11, playerCount: 2 });
  const [a, b] = metrics.players;
  console.log(
    `  [双人] 存活 ${metrics.time.toFixed(0)}s 波次=${metrics.wave} 合计击杀=${metrics.kills} | ` +
      `P1 击杀 ${a.kills} 命中 ${(a.accuracy * 100).toFixed(0)}% | P2 击杀 ${b.kills} 命中 ${(b.accuracy * 100).toFixed(0)}%`
  );
  assert.equal(metrics.players.length, 2);
  assert.ok(metrics.kills > 20, `双人合计击杀太少：${metrics.kills}`);
  assert.ok(a.kills > 0 && b.kills > 0, '两个人都应该打到东西');
  assert.ok(a.accuracy > 0.05 && b.accuracy > 0.05, '两个人都不该完全打不中');
});

test('双人 8 分钟长跑不炸（对象数量收敛）', () => {
  let maxObjects = 0;
  const { metrics } = runHeadless({
    frames: 60 * 480,
    seed: 12,
    playerCount: 2,
    revive: true,
    onFrame: (world) => {
      maxObjects = Math.max(maxObjects, world.particles.length + world.bullets.length + world.enemies.length);
      for (const p of world.players) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), '玩家坐标不该 NaN');
        assert.ok(Number.isFinite(p.heat), '热量不该 NaN');
        assert.ok(p.hp <= p.stats.hpMax + 1e-6, '血量不该超过上限');
      }
    },
  });
  assert.ok(maxObjects < 8000, `对象总数失控: ${maxObjects}`);
  assert.ok(metrics.kills > 250, `8 分钟双人只杀了 ${metrics.kills} 个`);
});
