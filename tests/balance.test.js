import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless } from '../src/harness.js';
import { STEP } from '../src/content.js';

test('AI 能活下来并推进波次（核心玩法闭环成立）', () => {
  const { metrics } = runHeadless({ frames: 60 * 180, seed: 1 });
  console.log(
    `  [平衡] seed=1 存活 ${metrics.time.toFixed(1)}s 波次=${metrics.wave} 击杀=${metrics.kills} ` +
      `命中率=${(metrics.accuracy * 100).toFixed(1)}% 卡片=${metrics.cards.length}`
  );
  assert.ok(metrics.kills > 10, `AI 应该能打死东西，实际击杀 ${metrics.kills}`);
  assert.ok(metrics.wavesCleared >= 1, `AI 至少清掉一波，实际 ${metrics.wavesCleared}`);
  assert.ok(metrics.accuracy > 0.1, `命中率不该低到离谱：${metrics.accuracy}`);
});

test('多个种子下都不出现数值爆炸或瞬间暴毙', () => {
  const rows = [];
  for (const seed of [2, 3, 4, 5, 6]) {
    const { metrics, world } = runHeadless({ frames: 60 * 120, seed });
    rows.push(`seed=${seed} 存活=${metrics.time.toFixed(0)}s 波次=${metrics.wave} 击杀=${metrics.kills}`);
    assert.ok(metrics.time > 12, `seed=${seed} 12 秒内就死了，可能太难: ${metrics.time.toFixed(1)}s`);
    assert.ok(Number.isFinite(world.player.hp));
    assert.ok(world.player.stats.hpMax < 400, '结构上限不应该失去控制');
  }
  console.log('  [平衡] ' + rows.join(' | '));
});

test('AI 会主动管理热量：热量被顶到高位但不会锁死', () => {
  let maxHeatRatio = 0;
  const { metrics } = runHeadless({
    frames: 60 * 90,
    seed: 9,
    onFrame: (world) => {
      if (world.dead) return;
      maxHeatRatio = Math.max(maxHeatRatio, world.player.heat / world.player.stats.heatMax);
    },
  });
  console.log(`  [平衡] 90 秒内热量峰值 ${(maxHeatRatio * 100).toFixed(0)}%，波次 ${metrics.wave}，击杀 ${metrics.kills}`);
  assert.ok(maxHeatRatio > 0.5, `热量机制应该真的被用上，峰值只有 ${(maxHeatRatio * 100).toFixed(0)}%`);
  assert.ok(metrics.frames > 60 * 20, 'AI 不该在 20 秒内暴毙');
});

test('同一颗种子完全可复现（确定性）', () => {
  const a = runHeadless({ frames: 60 * 30, seed: 12345 });
  const b = runHeadless({ frames: 60 * 30, seed: 12345 });
  assert.equal(a.metrics.kills, b.metrics.kills);
  assert.equal(a.metrics.wave, b.metrics.wave);
  assert.equal(a.metrics.hp, b.metrics.hp);
  assert.deepEqual(a.metrics.cards, b.metrics.cards);
  assert.ok(STEP > 0);
});
