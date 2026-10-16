// BGM 选曲逻辑的回归测试。
// 重点：不同界面状态该放哪首歌、弹窗时该不该压低音量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, musicGain, pickTrack } from '../src/music.js';

test('曲目表：两条音轨都有文件与显示名', () => {
  for (const [id, t] of Object.entries(TRACKS)) {
    assert.equal(t.id, id);
    assert.match(t.file, /^\.\/assets\/music\/.+\.mp3$/, `${id} 的路径不对`);
    assert.ok(t.label && t.label.length > 2, `${id} 缺少显示名`);
    assert.ok(t.volume > 0 && t.volume <= 1);
  }
});

test('选曲：战斗放主题曲，标题/结算放片尾曲', () => {
  assert.equal(pickTrack({ uiMode: 'title' }), 'ending');
  assert.equal(pickTrack({ uiMode: 'running' }), 'theme');
  assert.equal(pickTrack({ uiMode: 'upgrade' }), 'theme');
  assert.equal(pickTrack({ uiMode: 'paused' }), 'theme');
  assert.equal(pickTrack({ uiMode: 'over' }), 'ending');
  assert.equal(pickTrack({ uiMode: 'dying' }), 'ending');
  assert.equal(pickTrack({ uiMode: 'running', dead: true }), 'ending', '死了就该切片尾曲');
});

test('选曲：Boss 登场切战斗曲，打完切回主题曲', () => {
  assert.equal(pickTrack({ uiMode: 'running', boss: true }), 'battle', 'Boss 战要放《十七秒》');
  assert.equal(pickTrack({ uiMode: 'running', boss: false }), 'theme');
  // Boss 期间如果死了，优先级是"结算 > Boss"
  assert.equal(pickTrack({ uiMode: 'running', boss: true, dead: true }), 'ending');
  // Boss 期间停手选卡，仍然是战斗曲
  assert.equal(pickTrack({ uiMode: 'upgrade', boss: true }), 'battle');
});

test('选曲：未知状态不放歌，而不是报错', () => {
  assert.equal(pickTrack({ uiMode: 'loading' }), null);
  assert.equal(pickTrack({}), null);
  assert.equal(pickTrack(), null);
});

test('音量：弹窗/暂停时压低，战斗/结算给足', () => {
  const play = musicGain({ uiMode: 'running' });
  assert.ok(musicGain({ uiMode: 'upgrade' }) < play, '选卡读文字时应该让位');
  assert.ok(musicGain({ uiMode: 'paused' }) < play, '暂停时应该压低');
  assert.ok(musicGain({ uiMode: 'over' }) >= musicGain({ uiMode: 'title' }), '结算比标题更满一点');
  for (const st of ['title', 'running', 'upgrade', 'paused', 'over', 'dying']) {
    const g = musicGain({ uiMode: st });
    assert.ok(g > 0 && g <= 1, `${st} 的增益应该在 (0,1]：${g}`);
  }
});

test('选曲稳定：同一状态多次调用结果一致（不会来回切歌）', () => {
  const seq = ['title', 'running', 'running', 'upgrade', 'upgrade', 'running', 'over'];
  const got = seq.map((m) => pickTrack({ uiMode: m }));
  assert.deepEqual(got, ['ending', 'theme', 'theme', 'theme', 'theme', 'theme', 'ending']);
  // 中间连续相同 → 不该产生切换
  let switches = 0;
  for (let i = 1; i < got.length; i++) if (got[i] !== got[i - 1]) switches++;
  assert.equal(switches, 2, `整段只该切两次歌，实际 ${switches}`);

  // 带 Boss 的战斗流程：主题曲 → 战斗曲 → 主题曲
  const bossFlow = [
    { uiMode: 'running', boss: false },
    { uiMode: 'running', boss: true },
    { uiMode: 'running', boss: true },
    { uiMode: 'running', boss: false },
  ].map(pickTrack);
  assert.deepEqual(bossFlow, ['theme', 'battle', 'battle', 'theme']);
});
