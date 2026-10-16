// 平衡台：让 AI 跑一堆种子，输出"数字陪玩"的成绩单，作为你的人类成绩参照。
// 用法：
//   node tools/simulate.mjs                     # 单人 8 个种子 × 180 秒
//   node tools/simulate.mjs 1,2,3,4 120 2       # 双人 4 个种子 × 120 秒
import { runHeadless } from '../src/harness.js';
import { CARDS } from '../src/upgrades.js';

const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const seconds = Number(process.argv[3] ?? 180);
const playerCount = Number(process.argv[4] ?? 1);

const rows = [];
let sumKills = 0;
let sumWave = 0;
let sumAcc = 0;
let deaths = 0;
const perPlayer = Array.from({ length: playerCount }, () => ({ kills: 0, acc: 0, cards: 0 }));

for (const seed of seeds) {
  const { metrics } = runHeadless({ frames: 60 * seconds, seed, playerCount });
  rows.push(metrics);
  sumKills += metrics.kills;
  sumWave += metrics.wavesCleared;
  sumAcc += metrics.accuracy;
  if (metrics.died) deaths++;
  metrics.players.forEach((p, i) => {
    perPlayer[i].kills += p.kills;
    perPlayer[i].acc += p.accuracy;
    perPlayer[i].cards += p.cards.length;
  });
}

const pad = (v, n) => String(v).padEnd(n, ' ');
const title = playerCount > 1 ? `双人（${playerCount}P）` : '单人';
process.stdout.write(`NEON CORE 平衡台 · ${title} · ${seeds.length} 个种子 × ${seconds}s\n`);
process.stdout.write(pad('seed', 6) + pad('存活', 9) + pad('结局', 8) + pad('波次', 8) + pad('击杀', 6) + pad('命中', 8) + pad('血量', 9) + '拿到的卡\n');
rows.forEach((r, i) => {
  process.stdout.write(
    pad(seeds[i], 6) +
      pad(`${r.time.toFixed(0)}s`, 9) +
      pad(r.died ? '阵亡' : '存活', 8) +
      pad(`${r.wavesCleared}/w${r.wave}`, 8) +
      pad(r.kills, 6) +
      pad(`${(r.accuracy * 100).toFixed(0)}%`, 8) +
      pad(r.hpMaxAll.map((h) => Math.round(h)).join('/'), 9) +
      r.cards.length +
      '\n'
  );
});
process.stdout.write(
  `\n平均：击杀 ${(sumKills / rows.length).toFixed(1)} | 清波 ${(sumWave / rows.length).toFixed(1)} | ` +
    `命中率 ${((sumAcc / rows.length) * 100).toFixed(1)}% | 阵亡率 ${((deaths / rows.length) * 100).toFixed(0)}%\n`
);
if (playerCount > 1) {
  perPlayer.forEach((p, i) => {
    process.stdout.write(
      `P${i + 1}：平均击杀 ${(p.kills / rows.length).toFixed(1)} | 命中 ${((p.acc / rows.length) * 100).toFixed(0)}% | ` +
        `平均强化 ${(p.cards / rows.length).toFixed(1)}\n`
    );
  });
  process.stdout.write('（P2 用的是"方向键八向瞄准"，比鼠标弱，命中率天然低一截）\n');
}
process.stdout.write(`卡池共 ${CARDS.length} 张。\n`);
