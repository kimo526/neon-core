// 极限模式（不回血）的回归测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTREME, STEP, grantHeal } from '../src/content.js';
import { chooseCard, createWorld, makeInput, p1, skipRemainingCards, step, triggerProc } from '../src/sim.js';
import { cardText } from '../src/upgrades.js';
import { CARDS } from '../src/upgrades.js';
import { runHeadless } from '../src/harness.js';

const blank = makeInput();

const healCards = ['armor', 'killheal', 'nanoswarm'];

test('极限模式：世界标记正确，标准模式不受影响', () => {
  const std = createWorld(90);
  const ext = createWorld(90, { mode: 'extreme' });
  assert.equal(std.noHeal, false);
  assert.equal(std.mode, 'standard');
  assert.equal(ext.noHeal, true);
  assert.equal(ext.mode, 'extreme');
  // 其他规则完全一致（难度不加码，极限靠"不能回血"本身）
  assert.equal(ext.coopBonus, std.coopBonus);
  assert.equal(ext.playerCount, std.playerCount);
});

test('极限模式：grantHeal 一滴血都不回', () => {
  const w = createWorld(91, { mode: 'extreme' });
  const p = p1(w);
  p.hp = 30;
  p.stats.hpMax = 100;
  const gained = grantHeal(w, p, 50);
  assert.equal(p.hp, 30, '极限模式下血量必须纹丝不动');
  assert.equal(gained, 0, '没有护盾容量时不该有任何收益');
});

test('极限模式：回复属性完全失效（regen/击杀都不回血）', () => {
  const w = createWorld(92, { mode: 'extreme' });
  const p = p1(w);
  // 清场，并且把游戏"按在选卡阶段"：这样不会再有新波次刷怪来打扰（伤害会污染这个测试）
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  w.phase = 'upgrade';
  w.cardChoices = [[], []];
  p.stats.regen = 5;
  p.stats.lifeOnKill = 0.5;
  p.stats.shieldMax = 60;
  p.hp = 40;
  p.stats.hpMax = 100;
  let minHp = p.hp;
  for (let i = 0; i < 60 * 5; i++) {
    step(w, blank, STEP);
    w.enemies.length = 0; // 双保险：场地保持真空
    minHp = Math.min(minHp, p.hp);
  }
  assert.equal(p.hp, 40, `regen 在极限模式不该生效，现在 hp=${p.hp}（最低 ${minHp}）`);
  assert.ok(p.shield > 0, '回复应该被转成护盾（这样回血卡才不是废卡）');
  assert.ok(p.shield <= EXTREME.overflowShieldCap, `护盾不该超上限：${p.shield}`);
});

test('极限模式：反复施加回复，血量也绝不上升', () => {
  const w = createWorld(92.5, { mode: 'extreme' });
  const p = p1(w);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  p.hp = 25;
  p.stats.shieldMax = 60;
  let maxHp = p.hp;
  for (let i = 0; i < 200; i++) {
    grantHeal(w, p, 8);
    step(w, blank, STEP);
    maxHp = Math.max(maxHp, p.hp);
  }
  assert.equal(maxHp, 25, `200 次回复后血量仍应纹丝不动，实际最高 ${maxHp}`);
});

test('极限模式：回血卡依然有用（转成护盾），不是废卡', () => {
  const w = createWorld(93, { mode: 'extreme' });
  const p = p1(w);
  p.stats.shieldMax = 60; // 有容量才能接收转化
  p.hp = 40;
  const gained = grantHeal(w, p, 20);
  assert.ok(gained > 0, '有护盾容量时，回血应该转成护盾');
  assert.ok(p.shield > 0 && p.shield <= EXTREME.overflowShieldCap, `护盾不该超过上限：${p.shield}`);
  assert.equal(p.hp, 40, '血量依然不动');
});

test('极限模式：复合装甲只加上限，不回复当前值', () => {
  const w = createWorld(94, { mode: 'extreme' });
  const p = p1(w);
  p.hp = 50;
  const max0 = p.stats.hpMax;
  // allowAny：跳过"必须从发的三张里选"的限制，直接测这张卡本身
  assert.equal(chooseCard(w, 'armor', p.id, { allowAny: true }), true);
  assert.equal(p.stats.hpMax, max0 + 25, '上限要加');
  assert.equal(p.hp, 50, '当前值不该被回复');
  // 卡面文案要如实说明
  const armor = CARDS.find((c) => c.id === 'armor');
  assert.match(cardText(armor, p.stats, w), /极限模式/, '极限模式下卡面要写明不回复');
});

test('极限模式：残骸回收的卡面在极限模式会改口', () => {
  const w = createWorld(95, { mode: 'extreme' });
  const p = p1(w);
  const killheal = CARDS.find((c) => c.id === 'killheal');
  const extText = cardText(killheal, p.stats, w);
  const stdText = cardText(killheal, p.stats, createWorld(95));
  assert.match(extText, /护盾/, `极限模式文案应说清转护盾，实际：${extText}`);
  assert.match(stdText, /恢复/, '标准模式文案照旧');
  assert.notEqual(extText, stdText);
});

test('极限模式：大奖（超载回满）也给不了血，改成满护盾 + 超长无敌', () => {
  const w = createWorld(96, { mode: 'extreme' });
  const p = p1(w);
  p.hp = 12;
  p.iframe = 0;
  w.procRate = 1;
  assert.equal(triggerProc(w, p, null), true);
  assert.equal(p.hp, 12, '极限模式下大奖也不该回血');
  assert.ok(p.shield >= EXTREME.overflowShieldCap, '应该给满护盾');
  assert.ok(p.iframe >= 3, `应该给超长无敌，实际 ${p.iframe}`);
  assert.equal(p.heat, 0, '热量照旧清零');
  assert.ok(p.charges > 0, '冲刺照旧回满');
});

test('极限模式：擦弹奖励照常（护盾不是回血，允许）', () => {
  const w = createWorld(97, { mode: 'extreme' });
  const p = p1(w);
  p.x = 480;
  p.y = 270;
  p.hp = 20;
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  w.eBullets.push({ x: 480, y: 244, vx: 0, vy: 20, r: 5, damage: 1, life: 2, color: '#ff5c8a', age: 0 });
  for (let i = 0; i < 4; i++) step(w, blank, STEP);
  assert.ok(p.graze > 0, '极限模式下擦弹照常计数');
  assert.equal(p.hp, 20, '但血量不受影响');
});

test('极限模式：AI 跑得动，且明显比标准模式活得短', () => {
  const std = runHeadless({ frames: 60 * 200, seed: 101, mode: 'standard' });
  const ext = runHeadless({ frames: 60 * 200, seed: 101, mode: 'extreme' });
  console.log(
    `  [极限] 标准：存活 ${std.metrics.time.toFixed(0)}s 波次 ${std.metrics.wave} | ` +
      `极限：存活 ${ext.metrics.time.toFixed(0)}s 波次 ${ext.metrics.wave}`
  );
  assert.ok(ext.metrics.time <= std.metrics.time + 1, '极限模式不该比标准模式活得更久');
  assert.ok(ext.metrics.kills > 10, `极限模式下也该打得动，击杀 ${ext.metrics.kills}`);
});

test('极限模式：长时间不回血也不会出现负数或 NaN', () => {
  const { world } = runHeadless({
    frames: 60 * 300,
    seed: 102,
    mode: 'extreme',
    revive: true,
    onFrame: (w) => {
      for (const p of w.players) {
        assert.ok(Number.isFinite(p.hp), 'HP 不该 NaN');
        assert.ok(p.hp >= 0 && p.hp <= p.stats.hpMax, `HP 越界：${p.hp}/${p.stats.hpMax}`);
        assert.ok(Number.isFinite(p.shield));
      }
    },
  });
  assert.ok(world.stats.kills > 0);
});
