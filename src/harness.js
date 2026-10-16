// 无头模拟器：让 AI 用和人类完全相同的接口把游戏跑起来，用于平衡与回归测试。
import { createWorld, step, chooseCard, accuracy, playerAccuracy } from './sim.js';
import { createBot } from './bot.js';
import { STEP } from './content.js';

const HP_CARDS = ['armor', 'kinetic', 'nanoswarm', 'killheal'];

/** 给某个还没选卡的玩家按策略选一张（血少就优先保命卡） */
export function pickCard(world, playerId = null) {
  const slot = playerId ? world.players.findIndex((p) => p.id === playerId) : world.cardChoices.findIndex((l) => l.length);
  if (slot < 0 || !world.cardChoices[slot]?.length) return null;
  const p = world.players[slot];
  const choices = world.cardChoices[slot];
  const hpRatio = p.hp / p.stats.hpMax;
  let id = choices[0];
  if (hpRatio < 0.7) {
    id = choices.find((c) => HP_CARDS.includes(c)) ?? id;
  } else {
    id = choices[Math.floor(world.rng() * choices.length)];
  }
  chooseCard(world, id, p.id);
  return id;
}

/**
 * @param {object} opts
 * @param {number} opts.playerCount 1 或 2
 * @param {object} opts.botOpts     传给 P1 的 AI 配置
 * @param {object} opts.bot2Opts    传给 P2 的 AI 配置（默认用键盘式瞄准，更像真人）
 */
export function runHeadless({
  frames = 60 * 180,
  seed = 1,
  botOpts = {},
  bot2Opts = { quantizedAim: true },
  playerCount = 1,
  onFrame = null,
  pickCards = true,
  revive = false,
} = {}) {
  const world = createWorld(seed, { playerCount });
  const bots = [
    createBot({ seed, index: 0, ...botOpts }),
    createBot({ seed: seed + 991, index: 1, ...bot2Opts }),
  ];
  const inputs = [{}, {}];
  let diedAtFrame = null;
  let revives = 0;

  for (let f = 0; f < frames; f++) {
    if (world.dead) {
      if (!revive) {
        diedAtFrame = f;
        break;
      }
      revives++;
      world.dead = false;
      for (const p of world.players) {
        p.down = false;
        p.hp = p.stats.hpMax;
        p.iframe = 1.5;
      }
    }
    for (let i = 0; i < playerCount; i++) {
      inputs[i] = bots[i].think(world, STEP, world.players[i]);
    }
    step(world, inputs, STEP);
    if (pickCards && world.phase === 'upgrade') {
      let guard = 0;
      while (world.cardChoices.some((l) => l.length) && guard++ < 4) pickCard(world);
    }
    if (onFrame) onFrame(world, f);
  }

  const played = diedAtFrame ?? frames;
  const players = world.players.map((p) => ({
    id: p.id,
    name: p.name,
    down: p.down,
    hp: p.hp,
    hpMax: p.stats.hpMax,
    kills: p.statsRun.kills,
    damage: p.statsRun.damageDealt,
    accuracy: playerAccuracy(p),
    cards: p.stats.taken.slice(),
  }));

  return {
    world,
    metrics: {
      frames: played,
      time: played * STEP,
      died: world.dead,
      revives,
      playerCount,
      wave: world.wave,
      wavesCleared: world.stats.waves,
      kills: world.stats.kills,
      accuracy: accuracy(world),
      damage: players.reduce((s, p) => s + p.damage, 0),
      hp: world.players[0].hp,
      hpMax: world.players[0].stats.hpMax,
      hpMaxAll: world.players.map((p) => p.stats.hpMax),
      cards: world.players[0].stats.taken.slice(),
      players,
      enemiesAlive: world.enemies.length,
      bulletsAlive: world.bullets.length,
      particlesAlive: world.particles.length,
    },
  };
}
