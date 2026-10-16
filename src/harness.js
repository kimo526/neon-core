// 无头模拟器：让 AI 用和人类完全相同的接口把游戏跑起来，用于平衡与回归测试。
import { createWorld, step, chooseCard, accuracy } from './sim.js';
import { createBot } from './bot.js';
import { STEP } from './content.js';

const HP_CARDS = ['armor', 'kinetic', 'nanoswarm', 'killheal'];

export function pickCard(world) {
  const { cardChoices } = world;
  if (!cardChoices?.length) return null;
  const hpRatio = world.player.hp / world.player.stats.hpMax;
  let id = cardChoices[0];
  if (hpRatio < 0.7) {
    const heal = cardChoices.find((c) => HP_CARDS.includes(c));
    if (heal) id = heal;
  } else {
    id = cardChoices[Math.floor(world.rng() * cardChoices.length)];
  }
  chooseCard(world, id);
  return id;
}

export function runHeadless({ frames = 60 * 180, seed = 1, botOpts = {}, onFrame = null, pickCards = true, revive = false } = {}) {
  const world = createWorld(seed);
  const bot = createBot({ seed, ...botOpts });
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
      world.player.hp = world.player.stats.hpMax;
      world.player.iframe = 1.5;
    }
    const input = bot.think(world, STEP);
    step(world, input, STEP);
    if (pickCards && world.phase === 'upgrade') pickCard(world);
    if (onFrame) onFrame(world, f);
  }

  return {
    world,
    metrics: {
      frames: diedAtFrame ?? frames,
      time: (diedAtFrame ?? frames) * STEP,
      died: world.dead,
      revives,
      wave: world.wave,
      wavesCleared: world.stats.waves,
      kills: world.stats.kills,
      accuracy: accuracy(world),
      hp: world.player.hp,
      hpMax: world.player.stats.hpMax,
      cards: world.player.stats.taken.slice(),
      heatPeakLock: world.heatLock,
      enemiesAlive: world.enemies.length,
      bulletsAlive: world.bullets.length,
      particlesAlive: world.particles.length,
    },
  };
}
