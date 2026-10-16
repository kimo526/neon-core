import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, STEP, TUNING } from '../src/content.js';
import { accuracy, chooseCard, createWorld, makeInput, p1, step, triggerProc, waveComposition } from '../src/sim.js';
import { CARDS, applyCard, createStats, rollCards, cardText } from '../src/upgrades.js';
import { runHeadless } from '../src/harness.js';

// ---------- 冲刺构筑 / 特殊攻击 用的测试夹具 ----------

/** 放一个静止的靶子敌人 */
const placeEnemy = (world, x, y, over = {}) => {
  world.enemies.length = 0;
  world.spawnQueue.length = 0;
  world.enemies.push({
    id: 999,
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
    stunned: 0,
    knockX: 0,
    knockY: 0,
    phase: 0,
    targetId: 0,
    ...over,
  });
  return world.enemies[0];
};

/** 只把玩家移动放进去的最小输入 */
const dashInput = (over = {}) => ({ ...makeInput(), dash: true, moveX: 1, moveY: 0, ...over });

test('新世界状态自洽：玩家满血、有初始波次', () => {
  const w = createWorld(7);
  assert.equal(p1(w).hp, p1(w).stats.hpMax);
  assert.equal(w.dead, false);
  assert.equal(w.wave, 1);
  assert.ok(w.spawnQueue.length > 0, '第 1 波应该排进了生成队列');
  assert.ok(p1(w).x > 0 && p1(w).x < ARENA.w);
});

test('子弹命中敌人才会造成伤害', () => {
  const w = createWorld(3);
  const target = placeEnemy(w, 500, 100);
  p1(w).x = 500;
  p1(w).y = 300;
  const input = { ...makeInput(), aimX: 500, aimY: 100, firing: true };
  const hp0 = target.hp;
  for (let i = 0; i < 30 && target.hp === hp0; i++) step(w, input, STEP);
  assert.ok(target.hp < hp0, '朝敌人射击应该扣血');
  assert.ok(p1(w).statsRun.shots > 0);
  assert.ok(p1(w).statsRun.hits > 0);
  assert.ok(accuracy(w) > 0 && accuracy(w) <= 1);
});

test('不瞄准时打不中（碰撞检测不是无条件命中）', () => {
  const w = createWorld(3);
  const target = placeEnemy(w, 500, 100);
  p1(w).x = 500;
  p1(w).y = 300;
  const input = { ...makeInput(), aimX: 500, aimY: 540, firing: true }; // 朝下打
  for (let i = 0; i < 40; i++) step(w, input, STEP);
  assert.equal(target.hp, target.hpMax, '朝反方向开枪不该扣血');
});

test('按住扳机不散热：连射必须过热（核心节奏）', () => {
  const w = createWorld(5);
  placeEnemy(w, 500, 100);
  p1(w).x = 500;
  p1(w).y = 300;
  const input = { ...makeInput(), aimX: 500, aimY: 100, firing: true };
  let overheatedAt = -1;
  for (let i = 0; i < 60 * 3; i++) {
    step(w, input, STEP);
    assert.ok(p1(w).heat <= p1(w).stats.heatMax + 1e-6, `第 ${i} 帧热量超过上限`);
    if (w.events.some((e) => e.type === 'overheat')) {
      overheatedAt = i;
      break;
    }
  }
  assert.ok(overheatedAt > 0, '按住扳机 3 秒内必须过热');
  assert.ok(overheatedAt / 60 < 2.6, `过热太快了：${(overheatedAt / 60).toFixed(2)}s`);

  // 过热后继续按着：热量不降、也无法开火
  const shotsAtLock = p1(w).statsRun.shots;
  for (let i = 0; i < 60; i++) step(w, input, STEP);
  assert.equal(p1(w).heatLock, true, '一直按着就不该解锁');
  assert.equal(p1(w).statsRun.shots, shotsAtLock, '过热锁期间不应该打出子弹');

  // 松手才开始散热，降到阈值就解锁（惩罚要有，但不能罚站太久）
  let unlockFrames = 0;
  for (let i = 0; i < 60 * 5 && p1(w).heatLock; i++) {
    step(w, { ...input, firing: false }, STEP);
    unlockFrames++;
  }
  assert.equal(p1(w).heatLock, false, '松手后应该解除过热');
  assert.ok(unlockFrames / 60 < 2.5, `过热惩罚太长：${(unlockFrames / 60).toFixed(2)}s`);
  assert.ok(
    p1(w).heat <= p1(w).stats.heatMax * 0.31,
    `解锁时热量应该已经降到阈值附近，实际 ${p1(w).heat}`
  );

  // 解锁后能立刻继续开火
  const before = p1(w).statsRun.shots;
  for (let i = 0; i < 30 && p1(w).statsRun.shots === before; i++) step(w, input, STEP);
  assert.ok(p1(w).statsRun.shots > before, '解锁后应该能继续射击');
});

test('持续射击会过热，过热后停火才能恢复', () => {
  const w = createWorld(5);
  const target = placeEnemy(w, 500, 100);
  p1(w).x = 500;
  p1(w).y = 300;
  const input = { ...makeInput(), aimX: 500, aimY: 100, firing: true };
  let overheated = false;
  for (let i = 0; i < 60 * 5 && !overheated; i++) {
    step(w, input, STEP);
    overheated = w.events.some((e) => e.type === 'overheat');
  }
  assert.ok(overheated, '5 秒连射应该触发过热');
  assert.ok(p1(w).heat >= p1(w).stats.heatMax - 1e-6);

  // 松手：热量必须下降并解除锁定
  const input2 = { ...input, firing: false };
  const heatAtLock = p1(w).heat;
  for (let i = 0; i < 60 * 4 && p1(w).heatLock; i++) step(w, input2, STEP);
  assert.ok(p1(w).heat < heatAtLock, '松开扳机后热量应该下降');
  assert.equal(p1(w).heatLock, false, '热量清零后应该解除过热锁');
  assert.ok(target.hp < target.hpMax, '这段测试期间应该有命中');
});

test('冲刺提供无敌帧并且会进入冷却', () => {
  const w = createWorld(11);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  const dash = { ...makeInput(), dash: true, moveX: 1, moveY: 0 };
  step(w, dash, STEP);
  assert.ok(p1(w).iframe > 0, '冲刺应该给无敌帧');
  assert.ok(p1(w).dashCd > 0, '冲刺应该进入冷却');

  const x1 = p1(w).x;
  const dash2 = { ...dash, moveX: -1 };
  step(w, dash2, STEP);
  assert.ok(p1(w).x > x1, '冷却中再按冲刺不应该反向位移（说明没被重复触发）');
});

test('卡片：推进过载缩短冲刺冷却', () => {
  const w = createWorld(13);
  const before = p1(w).stats.dashCooldown;
  assert.ok(chooseCard(w, 'thruster', null, { allowAny: true }));
  assert.ok(p1(w).stats.dashCooldown < before);
  assert.equal(w.phase, 'play', '选完卡应该恢复战斗');
});

test('卡片：二段推进让冲刺能连着放两次，然后才吃冷却', () => {
  const w = createWorld(17);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  chooseCard(w, 'doublejump', null, { allowAny: true });
  const input = { ...makeInput(), dash: true, moveX: 1, moveY: 0, aimX: 900, aimY: 270 };
  const idle = { ...input, dash: false };
  assert.equal(p1(w).charges, 2, '拿了二段推进应该一开始就有 2 段充能');

  step(w, input, STEP);
  assert.ok(p1(w).dashT > 0, '第一次冲刺应该生效');
  assert.equal(p1(w).charges, 1, `应该还剩 1 次冲刺，实际 ${p1(w).charges}`);
  assert.equal(p1(w).dashCd, 0, '还有充能时不该进冷却');

  // 等第一段冲刺动作结束，第二段立刻能放（不吃冷却）
  for (let i = 0; i < 12; i++) step(w, idle, STEP);
  assert.ok(p1(w).dashT <= 0, `第一次冲刺应该结束，剩余 ${p1(w).dashT}`);
  step(w, input, STEP);
  assert.ok(p1(w).dashT > 0, '第二段冲刺应该能紧接着放');
  assert.ok(p1(w).dashCd > 0, '充能耗尽后才开始冷却');

  // 两段都用完：这次真的要被冷却挡住
  for (let i = 0; i < 12; i++) step(w, idle, STEP);
  const cdBefore = p1(w).dashCd;
  step(w, input, STEP);
  assert.ok(p1(w).dashT <= 0, '充能空、冷却中也还能冲刺就不对了');
  assert.ok(cdBefore > 0);
  assert.equal(p1(w).charges, 0);

  // 冷却结束后充能回满
  for (let i = 0; i < 80; i++) step(w, idle, STEP);
  assert.equal(p1(w).charges, 2, `冷却结束后应该回满 2 段，实际 ${p1(w).charges}`);
});

test('没拿二段推进时只有一段冲刺', () => {
  const w = createWorld(97);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  const input = { ...makeInput(), dash: true, moveX: 1, moveY: 0 };
  step(w, input, STEP);
  assert.equal(p1(w).charges, 0);
  for (let i = 0; i < 12; i++) step(w, { ...input, dash: false }, STEP);
  step(w, input, STEP);
  assert.ok(p1(w).dashT <= 0, '单段冲刺不该能连着放两次');
});

test('卡片：复合装甲提高上限并立刻修复', () => {
  const w = createWorld(19);
  p1(w).hp = 40;
  const max0 = p1(w).stats.hpMax;
  chooseCard(w, 'armor', null, { allowAny: true });
  assert.equal(p1(w).stats.hpMax, max0 + 25);
  assert.equal(p1(w).hp, 65);
});

test('卡片：弹射协议让子弹撞墙反弹而不是消失', () => {
  const w = createWorld(23);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  chooseCard(w, 'ricochet', null, { allowAny: true });
  p1(w).x = 200;
  p1(w).y = 200;
  const input = { ...makeInput(), aimX: 0, aimY: 200, firing: true }; // 朝左墙打
  for (let i = 0; i < 60 && w.bullets.length === 0; i++) step(w, input, STEP);
  assert.ok(w.bullets.length > 0, '应该打出了子弹');
  for (let i = 0; i < 30; i++) step(w, { ...input, firing: false }, STEP);
  assert.ok(w.bullets.length > 0, '有弹射协议时子弹应在墙上反弹存活');
  assert.equal(w.bullets[0].ricochet, 0, '反弹次数应该被消耗');
});

test('卡片：相位脉冲在冲刺穿过敌人时造成伤害', () => {
  const w = createWorld(29);
  const e = placeEnemy(w, 700, 270);
  p1(w).x = 600;
  p1(w).y = 270;
  chooseCard(w, 'pulse', null, { allowAny: true });
  const hp0 = e.hp;
  const input = { ...makeInput(), dash: true, moveX: 1, moveY: 0 };
  for (let i = 0; i < 30; i++) step(w, input, STEP);
  assert.ok(e.hp < hp0, `冲刺穿过后应该掉血，现在 hp=${e.hp}`);
});

// ---------- 冲刺构筑 ----------

test('冲刺构筑：相位刀锋放大所有冲刺伤害', () => {
  const base = (card) => {
    const w = createWorld(61);
    const e = placeEnemy(w, 700, 270);
    p1(w).x = 600;
    p1(w).y = 270;
    chooseCard(w, 'pulse', null, { allowAny: true });
    if (card) chooseCard(w, card, null, { allowAny: true });
    for (let i = 0; i < 30; i++) step(w, dashInput(), STEP);
    return e.hpMax - e.hp;
  };
  const plain = base(null);
  const boosted = base('phaseblade');
  assert.ok(plain > 0, '相位脉冲本身要有伤害');
  assert.ok(boosted > plain * 1.8, `相位刀锋应该显著放大冲刺伤害：${plain} → ${boosted}`);
});

test('冲刺构筑：熔核尾迹在冲刺路径上留下持续伤害区', () => {
  const w = createWorld(62);
  const e = placeEnemy(w, 505, 270, { hp: 99999, hpMax: 99999 });
  p1(w).x = 500;
  p1(w).y = 270;
  chooseCard(w, 'coretrail', null, { allowAny: true });
  assert.equal(w.trails.length, 0);
  step(w, dashInput(), STEP);
  assert.equal(w.trails.length, 1, '冲刺应该留下尾迹');
  const hp0 = e.hp;
  // 停在原地别把敌人撞飞，让尾迹自己烧
  for (let i = 0; i < 20; i++) step(w, makeInput(), STEP);
  assert.ok(e.hp < hp0, `站在尾迹里应该持续掉血，现在 hp=${e.hp}`);
});

test('冲刺构筑：急停爆发打出一圈弹幕', () => {
  const w = createWorld(63);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  chooseCard(w, 'burststop', null, { allowAny: true });
  let maxBullets = 0;
  for (let i = 0; i < 20; i++) {
    step(w, dashInput(), STEP);
    maxBullets = Math.max(maxBullets, w.bullets.length);
  }
  assert.ok(maxBullets >= 8, `冲刺结束应该打出一圈弹幕，实际最多 ${maxBullets} 发`);
});

test('冲刺构筑：连锁冲刺让击杀返还冷却', () => {
  const w = createWorld(64);
  const e = placeEnemy(w, 300, 270, { hp: 1 });
  chooseCard(w, 'chaindash', null, { allowAny: true });
  // 先把充能打空、进入冷却
  step(w, dashInput(), STEP);
  for (let i = 0; i < 12; i++) step(w, makeInput(), STEP);
  const before = p1(w).dashCd;
  assert.ok(before > 0, '此时应该处于冲刺冷却中');
  const input = { ...makeInput(300, 270), firing: true };
  for (let i = 0; i < 60 && w.stats.kills === 0; i++) step(w, input, STEP);
  assert.equal(w.stats.kills, 1, '应该击杀了目标');
  assert.ok(p1(w).dashCd < before, `击杀应该返还冲刺冷却：${before} → ${p1(w).dashCd}`);
});

test('冲刺构筑：反射装甲给护盾，护盾优先抵挡伤害', () => {
  const w = createWorld(65);
  w.enemies.length = 0;
  w.spawnQueue.length = 0;
  chooseCard(w, 'reflectplate', null, { allowAny: true });
  step(w, dashInput(), STEP);
  assert.ok(p1(w).shield > 0, '冲刺应该获得护盾');
  const shield0 = p1(w).shield;

  // 手动打一下（数值可控），护盾应该先吃
  const e = placeEnemy(w, p1(w).x, p1(w).y, { radius: 30, damage: 20, speed: 0 });
  const hp0 = p1(w).hp;
  p1(w).iframe = 0;
  for (let i = 0; i < 3 && p1(w).shield >= shield0; i++) step(w, makeInput(), STEP);
  assert.ok(p1(w).shield < shield0, '护盾应该吸收伤害');
  assert.equal(p1(w).hp, hp0, '有护盾时不该掉血');
  void e;
});

test('冲刺构筑：破空在起步瞬间震住身边敌人，被震住的敌人不动', () => {
  const w = createWorld(66);
  const e = placeEnemy(w, 545, 270, { hp: 9999, hpMax: 9999, speed: 160, accel: 900 });
  p1(w).x = 500;
  p1(w).y = 270;
  chooseCard(w, 'voidbreak', null, { allowAny: true });
  step(w, dashInput(), STEP);
  assert.ok(e.stunned > 0, '冲刺起步时就该震住身边的敌人（不能等飞出去再判定）');
  const x0 = e.x;
  for (let i = 0; i < 10; i++) step(w, makeInput(), STEP);
  assert.ok(Math.abs(e.x - x0) < 2, `被震住的敌人不该移动：${x0} → ${e.x}`);
});

// ---------- 特殊攻击（0.1% 红黑超载回满）----------

test('特殊攻击：0.1% 概率触发，触发时状态全部回满', () => {
  const w = createWorld(67);
  const p = p1(w);
  // 先把自己搞得很惨
  p.hp = 7;
  p.heat = p.stats.heatMax;
  p.heatLock = true;
  p.shield = 0;
  p.dashCd = 3;
  p.charges = 0;
  p.stats.shieldMax = 50;

  w.procRate = 1; // 强制触发
  assert.equal(triggerProc(w, p, { x: p.x, y: p.y }), true);

  assert.equal(p.hp, p.stats.hpMax, '血量应该回满');
  assert.equal(p.heat, 0, '热量应该清零');
  assert.equal(p.heatLock, false, '过热锁应该解除');
  assert.equal(p.shield, 50, '护盾应该回满');
  assert.equal(p.dashCd, 0, '冲刺冷却应该清零');
  assert.ok(p.charges > 0, '冲刺充能应该回满');
  assert.ok(p.iframe > 0, '触发时应该给一小段无敌');
  assert.equal(p.jackpots, 1, '应该记一次超载次数');
  assert.ok(w.jackpot.life > 0, '应该播放红黑特效');
  assert.ok(w.events.some((e) => e.type === 'jackpot'), '应该发出 jackpot 事件');
});

test('特殊攻击：0.1% 概率的判定边界正确', () => {
  const w = createWorld(68);
  const p = p1(w);
  const tap = (v) => {
    w.rng = () => v;
    w.procRate = undefined;
    return triggerProc(w, p, null);
  };
  assert.equal(tap(0.0005), true, '小于 0.1% 的随机数应该触发');
  assert.equal(tap(0.005), false, '大于 0.1% 的随机数不该触发');
  assert.equal(tap(0.9), false);
  assert.equal(tap(0.0009999), true);
  assert.equal(tap(0.001), false, '正好等于阈值不触发');
});

test('特殊攻击：长跑统计上接近 0.1%', () => {
  const w = createWorld(69);
  const p = p1(w);
  const trials = 20000;
  let hits = 0;
  for (let i = 0; i < trials; i++) {
    p.heat = p.stats.heatMax;
    if (triggerProc(w, p, null)) hits++;
  }
  const rate = hits / trials;
  assert.ok(rate > 0.0002 && rate < 0.003, `${trials} 次的实测触发率 ${(rate * 100).toFixed(3)}% 偏离 0.1% 太多`);
});


test('卡片：残骸回收让击杀回血', () => {
  const w = createWorld(31);
  chooseCard(w, 'killheal', null, { allowAny: true });
  const e = placeEnemy(w, 300, 270);
  e.hp = 1;
  p1(w).hp = 50;
  const before = p1(w).hp;
  const input = { ...makeInput(), aimX: 300, aimY: 270, firing: true };
  for (let i = 0; i < 60 && w.stats.kills === 0; i++) step(w, input, STEP);
  assert.equal(w.stats.kills, 1, '应该击杀了目标');
  assert.ok(p1(w).hp > before, '击杀应该回血');
});

test('波次配比随难度增长，且生成敌人会吃系数', () => {
  const w1 = waveComposition(1);
  const w10 = waveComposition(10);
  assert.ok(w10.length > w1.length, '后面的波次敌人更多');
  assert.ok(w10.includes('tank'), '第 10 波应该有重甲');
  assert.ok(w10.some((t) => t === 'turret'), '第 10 波应该有炮台');

  const w = createWorld(37);
  w.spawnQueue.length = 0;
  // 手动生成第 10 波并推进时间，让敌人都落地
  w.wave = 10;
  w.spawnQueue = waveComposition(10).map((type, i) => ({
    type,
    at: 0.001 * i,
    scale: { hp: Math.pow(1.14, 9), speed: Math.pow(1.025, 9), damage: Math.pow(1.055, 9) },
  }));
  w.time = 10;
  for (let i = 0; i < 5; i++) step(w, makeInput(), STEP);
  const tank = w.enemies.find((e) => e.type === 'tank');
  assert.ok(tank, '第 10 波应该刷出 tank');
  assert.ok(tank.hpMax > 135 * 3, `tank 血量应该被放大，现在 ${tank.hpMax}`);
});

test('清空一波后会给出三张不重复的强化卡', () => {
  const w = createWorld(41);
  w.spawnQueue.length = 0;
  w.enemies.length = 0;
  for (let i = 0; i < 60 * 3 && w.phase !== 'upgrade'; i++) step(w, makeInput(), STEP);
  assert.equal(w.phase, 'upgrade', '清场后应该进入选卡阶段');
  const choices = w.cardChoices[0];
  assert.equal(choices.length, TUNING.cardCount);
  assert.equal(new Set(choices).size, TUNING.cardCount, '三张卡不应该重复');
  assert.ok(w.wave >= 2, '选卡时下一波已经开始排队');
  assert.equal(chooseCard(w, 'thruster', 1), false, '不该能拿没发到手上的卡');
  assert.equal(chooseCard(w, choices[0], 1), true);
  assert.equal(w.phase, 'play');
});

test('抽卡池：权重抽样不重复、能排除、卡池空了也不崩', () => {
  const rng = () => 0.42;
  const three = rollCards(rng, 3);
  assert.equal(three.length, 3);
  assert.equal(new Set(three.map((c) => c.id)).size, 3);
  const excluded = rollCards(rng, 3, [three[0].id, three[1].id]);
  assert.ok(!excluded.some((c) => c.id === three[0].id || c.id === three[1].id));
  const all = rollCards(rng, 999);
  assert.equal(all.length, CARDS.length, '要不出超过卡池数量的卡');
});

test('每张卡都有可读文案和合法效果', () => {
  const stats = createStats();
  for (const c of CARDS) {
    const text = cardText(c, stats);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, `${c.id} 缺文案`);
    assert.ok(c.weight > 0);
    assert.doesNotThrow(() => c.apply(createStats(), createWorld(1)));
  }
  // 记录已选卡，方便 UI/统计
  const w = createWorld(43);
  applyCard(w, 'overclock');
  assert.deepEqual(p1(w).stats.taken, ['overclock']);
});

test('长时间空跑不会出现 NaN / 越界 / 内存爆炸', () => {
  const w = createWorld(47);
  w.spawnQueue.length = 0;
  w.enemies.length = 0;
  const blank = makeInput();
  let maxParticles = 0;
  let maxObjects = 0;
  for (let i = 0; i < 60 * 240; i++) {
    w.time = i * STEP; // 让生成队列/波次判定持续推进，模拟真实对局时长
    step(w, blank, STEP);
    maxParticles = Math.max(maxParticles, w.particles.length);
    maxObjects = Math.max(maxObjects, w.particles.length + w.bullets.length + w.enemies.length);
    assert.ok(Number.isFinite(p1(w).x) && Number.isFinite(p1(w).y), `第 ${i} 帧玩家坐标 NaN`);
    assert.ok(p1(w).x >= 0 && p1(w).x <= ARENA.w, `第 ${i} 帧玩家越界`);
    assert.ok(p1(w).y >= 0 && p1(w).y <= ARENA.h, `第 ${i} 帧玩家越界`);
    for (const e of w.enemies) {
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `第 ${i} 帧敌人坐标 NaN`);
      assert.ok(e.hp > 0, '死掉的敌人应该被清出数组');
    }
  }
  assert.ok(maxParticles < 1200, `粒子数量失控: ${maxParticles}`);
  assert.ok(maxObjects < 1500, `对象总数失控: ${maxObjects}`);
  assert.ok(w.bullets.length < 500, '子弹数量失控');
});

test('多敌人战斗 8 分钟不炸：粒子与实体数量收敛', () => {
  let maxObjects = 0;
  let maxHeat = 0;
  const { metrics } = runHeadless({
    frames: 60 * 480,
    seed: 53,
    revive: true,
    onFrame: (world) => {
      maxObjects = Math.max(maxObjects, world.particles.length + world.bullets.length + world.enemies.length);
      maxHeat = Math.max(maxHeat, p1(world).heat);
      assert.ok(Number.isFinite(p1(world).heat), '热量不该变成 NaN');
      assert.ok(Number.isFinite(p1(world).x) && Number.isFinite(p1(world).y));
    },
  });
  assert.ok(maxObjects < 6000, `对象总数失控: ${maxObjects}`);
  assert.ok(maxHeat <= 220, `热量溢出上限: ${maxHeat}`);
  assert.ok(metrics.kills > 150, `8 分钟只杀了 ${metrics.kills} 个，可能循环卡住了`);
  assert.ok(metrics.wavesCleared >= 5, `8 分钟只清了 ${metrics.wavesCleared} 波`);
});

