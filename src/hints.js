// 侧边操作提示面板：静态按键说明 + 实时状态（Boss 血条 / 擦弹充能 / 超载次数 / 冲刺）
// 纯 DOM，和 canvas 分开，这样文字清晰度不受画布缩放影响。
import { GRAZE, TUNING } from './content.js';
import { activeBoss } from './sim.js';

const P1_KEYS = [
  ['W A S D', '移动'],
  ['鼠标', '瞄准'],
  ['左键', '射击'],
  ['空格', '冲刺'],
  ['1 / 2', '换武器'],
];

const P2_KEYS = [
  ['I J K L', '移动'],
  ['方向键', '瞄准'],
  ['分号 ;', '射击'],
  ['回车', '冲刺'],
  ['8 / 9', '换武器'],
];

const SYS_KEYS = [
  ['Esc', '暂停'],
  ['M', '静音（全部）'],
  ['N', '音乐开关'],
  ['[ ]', '音乐音量'],
  ['V', '播报开关'],
  ['G', 'AI 托管'],
];

export function createHints(root) {
  let cachedBoss = null;
  let built = false;

  function build() {
    // 窄屏时 .hints-inner 会变成横向两列，所以内容都装在它里面
    root.innerHTML = `
      <div class="hints-inner">
        <div class="hints-head"><span class="dot"></span> 操作提示</div>
        <div class="hints-block" id="hints-p1"></div>
        <div class="hints-block coop-only" id="hints-p2"></div>
        <div class="hints-block" id="hints-sys"></div>
        <div class="hints-live">
          <div class="hints-boss" id="hints-boss"></div>
          <div class="hints-graze">
            <div class="hints-row"><span>擦弹充能</span><b id="hints-graze-num">0%</b></div>
            <div class="bar"><i class="graze-fill"></i></div>
            <div class="hints-note">贴弹幕走会攒充能：满了补 1 段冲刺 + 12 护盾 + 0.35s 无敌</div>
          </div>
          <div class="hints-stats" id="hints-stats"></div>
        </div>
        <div class="hints-block" id="hints-audio"></div>
        <div class="hints-foot">
          <div id="hints-special"></div>
          <div class="hints-note">热量满了会锁枪 —— 想降温必须松开扳机</div>
        </div>
      </div>
    `;
    fillKeys(root.querySelector('#hints-p1'), '单人 / P1', P1_KEYS, 'var(--neon)');
    fillKeys(root.querySelector('#hints-p2'), 'P2', P2_KEYS, '#ff7ae0');
    fillKeys(root.querySelector('#hints-sys'), '系统', SYS_KEYS, '#8affc1');
    built = true;
  }

  function fillKeys(host, title, keys, color) {
    host.innerHTML =
      `<div class="hints-title" style="color:${color}">${title}</div>` +
      keys.map(([k, label]) => `<div class="hints-row"><b>${k}</b><span>${label}</span></div>`).join('');
  }

  function update(world) {
    if (!built) build();
    root.classList.toggle('coop', world.players.length > 1);

    // 特殊攻击说明（概率写在界面上，让玩家知道有这么个东西）
    const jackpots = world.players.reduce((s, p) => s + p.jackpots, 0);
    const special = root.querySelector('#hints-special');
    const rate = ((world.procRate ?? TUNING.jackpotChance) * 100).toFixed(world.procRate && world.procRate >= 0.01 ? 0 : 1);
    special.innerHTML = `<b>超载回满</b> <span class="tag">${rate}%</span> 已触发 <b>${jackpots}</b> 次`;

    // Boss 血条
    const boss = activeBoss(world);
    const bossBox = root.querySelector('#hints-boss');
    if (boss !== cachedBoss) {
      cachedBoss = boss;
      bossBox.innerHTML = boss
        ? `<div class="hints-title" style="color:${boss.color}">弹幕核心 · 第 ${world.wave} 波</div>
           <div class="bar boss"><i class="boss-fill"></i></div>
           <div class="hints-note" id="hints-boss-hp">100%</div>`
        : '';
    }
    if (boss) {
      const k = Math.max(0, boss.hp / boss.hpMax);
      bossBox.querySelector('.boss-fill').style.transform = `scaleX(${k})`;
      bossBox.querySelector('#hints-boss-hp').textContent = `${Math.ceil(boss.hp)} / ${Math.ceil(boss.hpMax)}（${(k * 100).toFixed(0)}%）`;
    }

    // 擦弹条：取充能最多的那个玩家（单人就是自己）
    const lead = world.players.reduce((a, b) => (b.grazeCharge > a.grazeCharge ? b : a), world.players[0]);
    const charge = Math.min(1, lead.grazeCharge / GRAZE.chargeNeeded);
    root.querySelector('.graze-fill').style.transform = `scaleX(${charge})`;
    root.querySelector('#hints-graze-num').textContent = `${Math.round(charge * 100)}%`;

    // 实时数据
    root.querySelector('#hints-stats').innerHTML = world.players
      .map((p) => {
        const dash = p.dashCd > 0 ? `${p.dashCd.toFixed(1)}s` : '就绪';
        return `<div class="hints-row"><b style="color:${p.color}">${p.name}</b><span>擦弹 ${p.graze} · 冲刺 ${dash}</span></div>`;
      })
      .join('');
  }

  /** 音响状态：BGM 曲目/音量、音效与播报开关（每帧刷，内容没变就不重建 DOM） */
  let lastAudioKey = '';
  function updateAudio(info) {
    if (!built) build();
    const host = root.querySelector('#hints-audio');
    if (!host) return;
    const key = `${info.musicOn}|${Math.round(info.musicVolume * 10)}|${info.musicLabel}|${info.sfxOn}|${info.voiceOn}`;
    if (key === lastAudioKey) return;
    lastAudioKey = key;
    const pct = Math.round(info.musicVolume * 100);
    host.innerHTML = `
      <div class="hints-title" style="color:var(--neon)">音频</div>
      <div class="hints-row"><b>♪ BGM</b><span>${info.musicOn ? `${pct}%` : '已关闭'}</span></div>
      <div class="hints-note" style="color:${info.musicOn ? '#8fb4cc' : '#5c707f'}">${
        info.musicOn ? (info.musicLabel ?? '（等待播放）') : '按 N 打开音乐'
      }</div>
      <div class="hints-row"><b>音效</b><span>${info.sfxOn ? '开' : '关'}</span></div>
      <div class="hints-row"><b>播报</b><span>${info.voiceOn ? '开' : '关'}</span></div>
      <div class="hints-row"><b>M / N / [ ]</b><span>静音 / 音乐 / 音量</span></div>
    `;
  }

  return { update, build, updateAudio };
}
