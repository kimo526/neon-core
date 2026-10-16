// 平衡台：让 AI 跑一堆种子，输出"数字陪玩"的成绩单，作为你的人类成绩参照。
import { runHeadless } from '../src/harness.js';
import { CARDS } from '../src/upgrades.js';

const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const seconds = Number(process.argv[3] ?? 180);
const rows = [];
let sumKills = 0;
let sumWave = 0;
let sumAcc = 0;
let deaths = 0;

for (const seed of seeds) {
  const { metrics } = runHeadless({ frames: 60 * seconds, seed });
  rows.push({
    seed,
    time: metrics.time,
    died: metrics.died,
    wave: metrics.wave,
    waves: metrics.wavesCleared,
    kills: metrics.kills,
    acc: metrics.accuracy,
    hp: metrics.hp,
    cards: metrics.cards.length,
  });
  sumKills += metrics.kills;
  sumWave += metrics.wavesCleared;
  sumAcc += metrics.accuracy;
  if (metrics.died) deaths++;
}

const pad = (v, n) => String(v).padEnd(n, ' ');
process.stdout.write(
  pad('seed', 6) + pad('存活', 9) + pad('结局', 8) + pad('波次', 6) + pad('击杀', 6) + pad('命中', 8) + pad('强化', 5) + '拿到的卡\n'
);
for (const r of rows) {
  process.stdout.write(
    pad(r.seed, 6) +
      pad(`${r.time.toFixed(0)}s`, 9) +
      pad(r.died ? '阵亡' : '存活', 8) +
      pad(`${r.waves}/w${r.wave}`, 6) +
      pad(r.kills, 6) +
      pad(`${(r.acc * 100).toFixed(0)}%`, 8) +
      pad(r.cards, 5) +
      '\n'
  );
}
process.stdout.write(
  `\n平均：击杀 ${(sumKills / rows.length).toFixed(1)} | 清波 ${(sumWave / rows.length).toFixed(1)} | ` +
    `命中率 ${((sumAcc / rows.length) * 100).toFixed(1)}% | 阵亡率 ${((deaths / rows.length) * 100).toFixed(0)}%\n`
);
process.stdout.write(`卡池共 ${CARDS.length} 张，AI 一局大约能吃到 ${(sumWave / rows.length * 0.5).toFixed(1)} 张。\n`);
