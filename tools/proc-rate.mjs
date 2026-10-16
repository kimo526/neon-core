// 特殊攻击触发率实测：先算"每分钟命中次数"，再换算 0.1% 到底多久出一次。
// 用法：node tools/proc-rate.mjs [秒数] [种子数]
import { runHeadless } from '../src/harness.js';

const seconds = Number(process.argv[2] ?? 120);
const seeds = Number(process.argv[3] ?? 4);

const rows = [];
for (let i = 0; i < seeds; i++) {
  const seed = 100 + i;
  const { world, metrics } = runHeadless({ frames: 60 * seconds, seed, playerCount: 1 });
  const hits = world.players.reduce((s, p) => s + p.statsRun.hits, 0);
  const shots = world.players.reduce((s, p) => s + p.statsRun.shots, 0);
  rows.push({ seed, hits, shots, time: metrics.time, kills: metrics.kills });
}

const avgHits = rows.reduce((s, r) => s + r.hits, 0) / rows.length;
const avgTime = rows.reduce((s, r) => s + r.time, 0) / rows.length;
const hitsPerMin = (avgHits / avgTime) * 60;

const pad = (v, n) => String(v).padEnd(n, ' ');
process.stdout.write(`实测时长 ${seconds}s × ${seeds} 个种子（AI 全力输出）\n`);
process.stdout.write(pad('seed', 7) + pad('命中', 8) + pad('射出', 8) + '存活\n');
for (const r of rows) {
  process.stdout.write(pad(r.seed, 7) + pad(r.hits, 8) + pad(r.shots, 8) + `${r.time.toFixed(0)}s\n`);
}

process.stdout.write(`\n平均命中率：每分钟 ${hitsPerMin.toFixed(0)} 次命中\n`);
process.stdout.write('按 0.1% 的触发率换算（"大约多久中一次大奖"）：\n');
for (const [label, rate] of [['游侠脉冲（1 发/次）', 1], ['重锤霰射（7 发/次）', 7]]) {
  const perMin = hitsPerMin * rate;
  const minutes = 1 / (perMin * 0.001);
  process.stdout.write(`  ${label}：每 ${minutes.toFixed(0)} 分钟一次（${(minutes * 60).toFixed(0)} 秒）\n`);
}
process.stdout.write(`\n参考：一次 5 分钟的对局 ≈ ${(hitsPerMin * 5).toFixed(0)} 次命中 → 中奖概率 ${(1 - Math.pow(0.999, hitsPerMin * 5)).toFixed(1)}%\n`);
