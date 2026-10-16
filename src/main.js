// 主循环：固定步长 60Hz 推进模拟，渲染跟随屏幕刷新率。
import { STEP, TUNING, UPGRADE_TAGS } from './content.js';
import { chooseCard, createWorld, skipRemainingCards, step, triggerProc } from './sim.js';
import { CARDS, cardText } from './upgrades.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';
import { createMusic } from './music.js';
import { createHints } from './hints.js';
import { createBot } from './bot.js';
import { pickCard as pickSmartCard } from './harness.js';
import { encodeQr } from './qr.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
// #overlay 在 HTML 里是空的：面板由这里创建，保证 JS 一定拿得到（不依赖 HTML 里有没有手写 .panel）
let panel = overlay.querySelector('.panel');
function ensurePanel() {
  if (!panel || !panel.isConnected) {
    panel = document.createElement('div');
    panel.className = 'panel';
    overlay.appendChild(panel);
  }
  return panel;
}
const hudRoot = document.getElementById('hud');
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const audio = createAudio();
// 机器人播报：共用音频引擎的上下文与总线
const voice = createVoice(
  () => audio.context,
  () => audio.bus
);
// BGM：标题/结算放片尾曲，战斗放主题曲（都来自你自己的《解限机》专辑）
const music = createMusic();
// 侧边操作提示面板（静态按键 + 实时 Boss 血条 / 擦弹充能）
const hints = createHints(document.getElementById('hints'));

const CARD_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit8: 0, Digit9: 1, Digit0: 2 };

let world = createWorld((Math.random() * 1e9) | 0, { playerCount: 1 });
let uiMode = 'title'; // title | running | upgrade | over | paused | dying
let acc = 0;
let speed = 1;
let last = performance.now();
let frameCount = 0;
let cardIds = [[]];
let hudSlots = [];
const bot = { enabled: false, autoPick: true, agents: [], cardDelay: 0 };

// ---------- HUD ----------
function buildHud() {
  hudRoot.innerHTML = '';
  hudSlots = [];
  const count = world.players.length;
  hudRoot.classList.toggle('coop', count > 1);
  for (const p of world.players) {
    const box = document.createElement('div');
    box.className = 'hud-player';
    box.style.setProperty('--pc', p.color);
    box.innerHTML = `
      <div class="row"><span class="label">${count > 1 ? p.name + ' · ' : ''}WAVE</span><span class="value wave">1</span></div>
      <div class="row"><span class="label">HP${world.noHeal ? '<b class="noregen">不回血</b>' : ''}</span><span class="value hp">100</span></div>
      <div class="bar"><i class="hpbar"></i></div>
      <div class="row"><span class="label">HEAT</span><span class="value heat">0%</span></div>
      <div class="bar"><i class="heatbar"></i></div>
      <div class="row"><span class="label">DASH</span><span class="value dash">READY</span></div>
      <div class="row"><span class="label">WEAPON</span><span class="value weapon">游侠脉冲</span></div>
      <div class="row"><span class="label">KILLS</span><span class="value kills">0</span></div>
      <div class="row"><span class="label">TIME</span><span class="value time">0.0s</span></div>
      <div class="row"><span class="label">超载</span><span class="value jackpot">0</span></div>
      <div class="row"><span class="label">擦弹</span><span class="value graze">0</span></div>
    `;
    hudRoot.appendChild(box);
    const q = (sel) => box.querySelector(sel);
    hudSlots.push({
      hp: q('.hp'),
      hpBar: q('.hpbar'),
      heat: q('.heat'),
      heatBar: q('.heatbar'),
      dash: q('.dash'),
      weapon: q('.weapon'),
      kills: q('.kills'),
      time: q('.time'),
      jackpot: q('.jackpot'),
      graze: q('.graze'),
      wave: q('.wave'),
    });
  }
}

function updateHud() {
  world.players.forEach((p, i) => {
    const h = hudSlots[i];
    if (!h) return;
    const st = p.stats;
    h.wave.textContent = world.wave;
    h.hp.textContent = p.down ? 'DOWN' : Math.max(0, Math.ceil(p.hp));
    h.hp.classList.toggle('warn', p.down);
    h.hpBar.style.transform = `scaleX(${p.down ? 0 : Math.max(0, Math.min(1, p.hp / st.hpMax))})`;
    const heatRatio = Math.min(1, p.heat / st.heatMax);
    h.heat.textContent = p.heatLock ? 'OVERHEAT' : `${Math.round(heatRatio * 100)}%`;
    h.heat.classList.toggle('warn', p.heatLock || heatRatio > 0.75);
    h.heatBar.style.transform = `scaleX(${heatRatio})`;
    h.dash.textContent = p.dashCd > 0 ? `${p.dashCd.toFixed(2)}s` : p.charges > 0 ? 'READY' : 'COOL';
    h.dash.classList.toggle('warn', p.dashCd > 0);
    h.weapon.textContent = st.weapon === 'heavy' ? '重锤霰射' : '游侠脉冲';
    h.kills.textContent = p.statsRun.kills;
    h.time.textContent = `${p.statsRun.timeAlive.toFixed(1)}s`;
    h.jackpot.textContent = p.jackpots;
    h.jackpot.classList.toggle('warn', world.jackpot.life > 0 && world.jackpot.id === p.id);
    h.graze.textContent = p.graze;
    // 极限模式：血量是不可再生资源，低了要刺眼
    if (world.noHeal) {
      const ratio = p.hp / st.hpMax;
      h.hp.classList.toggle('critical', ratio <= 0.3 && !p.down);
    }
  });
}

// ---------- 遮罩层 ----------
function setOverlay(html, { clickable = true } = {}) {
  ensurePanel().innerHTML = html;
  overlay.classList.add('show');
  overlay.style.cursor = clickable ? 'pointer' : 'default';
}

function hideOverlay() {
  overlay.classList.remove('show');
  document.body.classList.remove('title-open');
  cardIds = [[]];
}

/** 当前是不是触摸设备（和 input.js 用同一套判定） */
function isTouchDevice() {
  return (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
}

/**
 * 把当前地址画成二维码，方便手机扫（只有非 localhost 才有意义）。
 * 返回 HTML 字符串；canvas 会在插入 DOM 后由 attachShareQr 补上。
 */
let pendingQr = null;
function shareQrMarkup() {
  const host = location.hostname;
  const local = !host || host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:';
  if (local) {
    // 已经用手机打开了，就别再教人家"用电脑扫码"
    if (isTouchDevice()) return '';
    return `<p class="hint share">想让手机玩：电脑上双击 <b>share.cmd</b>，终端里会直接印出一个二维码</p>`;
  }
  try {
    const url = location.origin + location.pathname;
    const qr = encodeQr(url);
    const canvas = document.createElement('canvas');
    const scale = 3;
    const quiet = 2;
    const px = (qr.size + quiet * 2) * scale;
    canvas.width = px;
    canvas.height = px;
    canvas.className = 'qr';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eafcff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#05060b';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    pendingQr = { canvas, url };
    return `<p class="hint share">手机扫码直接进（同一个 WiFi）：</p><div id="qr-slot"></div>`;
  } catch {
    return '';
  }
}

/** innerHTML 之后把二维码画布插进去（canvas 没法走 HTML 字符串） */
function attachShareQr() {
  const slot = ensurePanel().querySelector('#qr-slot');
  if (!slot || !pendingQr) return;
  const holder = document.createElement('div');
  holder.className = 'qr-holder';
  const label = document.createElement('div');
  label.className = 'qr-label';
  label.textContent = pendingQr.url;
  holder.appendChild(pendingQr.canvas);
  holder.appendChild(label);
  slot.appendChild(holder);
  pendingQr = null;
}

function titleScreen() {
  uiMode = 'title';
  document.body.classList.add('title-open');
  setOverlay(`
    <h1>NEON <span>CORE</span></h1>
    <p class="sub">热量会锁枪 · 冲刺能穿敌 · 每 5 波一个弹幕核心</p>
    <p class="hint start">按 <b>回车</b> 单人 &nbsp;·&nbsp; <b>Tab</b> 双人 &nbsp;·&nbsp; <b>X</b> 极限 &nbsp;·&nbsp; <b>C</b> 双人极限 &nbsp;·&nbsp; 或点击这里</p>
    ${shareQrMarkup()}
    ${isTouchDevice() ? `<p class="hint touch">左半屏拖动 = 移动 · 右半屏点一下 = 冲刺 · 子弹自动索敌<br><b>横过来玩视野更好</b></p>` : ''}
    <details class="more">
      <summary>按键说明</summary>
      <ul class="keys">
        <li><b>P1</b>：WASD 移动 · 鼠标瞄准 · 左键射击 · 空格冲刺 · 1/2 换武器</li>
        <li><b>P2</b>：IJKL 移动 · 方向键瞄准 · 分号射击 · 回车冲刺 · 8/9 换武器</li>
        <li>选强化卡：P1 按 <b>1 2 3</b>，P2 按 <b>8 9 0</b></li>
        <li><b>Esc</b> 暂停 · <b>M</b> 静音 · <b>V</b> 播报 · <b>G</b> 让 AI 接管</li>
        <li>手机：左半屏拖动移动 · 右半屏点一下冲刺 · 子弹自动索敌</li>
      </ul>
    </details>
    <p class="hint">热量满了会自动锁枪 —— <b>想降温必须松开扳机</b></p>
    <p class="hint">贴着弹幕走能攒<b>擦弹充能</b>，满了补 1 段冲刺 + 护盾</p>
    <p class="hint">BGM（你的原创专辑）：主题曲《解限》 · Boss 战《十七秒》 · 结算《下个赛季见》</p>
    <p class="hint"><b>M</b> 静音 · <b>N</b> 音乐开关 · <b>[ ]</b> 音乐音量</p>
  `);
  attachShareQr();
}

function startRun(playerCount = 1, gameMode = 'standard') {
  world = createWorld((Math.random() * 1e9) | 0, { playerCount, mode: gameMode });
  input.clear();
  audio.unlock();
  music.unlock();
  acc = 0;
  uiMode = 'running';
  buildHud();
  bot.agents = world.players.map((p) => createBot({ seed: world.seed + p.index * 991, index: p.index }));
  hideOverlay();
  document.body.classList.toggle('extreme', world.noHeal);
}

function gameOver() {
  uiMode = 'over';
  const rows = world.players
    .map((p) => {
      const acc2 = p.statsRun.shots ? ((p.statsRun.hits / p.statsRun.shots) * 100).toFixed(0) : '0';
      const cards = p.stats.taken.map((id) => CARDS.find((c) => c.id === id)?.name ?? id).join(' · ') || '（一个都没捡）';
      return `<li><b style="color:${p.color}">${p.name}</b> 击杀 ${p.statsRun.kills} · 伤害 ${Math.round(p.statsRun.damage)} · 命中率 ${acc2}% · 存活 ${p.statsRun.timeAlive.toFixed(0)}s<br><span class="dim">${cards}</span></li>`;
    })
    .join('');
  const extreme = world.noHeal;
  setOverlay(`
    <h1>CORE <span>LOST</span></h1>
    <p class="sub">${extreme ? `极限模式：核心撑到第 ${world.wave} 波。` : `核心在第 ${world.wave} 波被打穿。`}</p>
    <ul class="keys score">${rows}</ul>
    <p class="hint">合计击杀 <b>${world.stats.kills}</b> · 清波 <b>${world.stats.waves}</b>${
      extreme ? ` · 极限模式最远到第 <b>${world.wave}</b> 波（不回血，这就是你的成绩）` : ''
    }</p>
    <p class="hint">按 <b>R</b> 或点击这里重开（沿用 ${world.players.length} 人${extreme ? ' · 极限' : ''}）</p>
  `);
}

function pickCard(id, playerId) {
  if (uiMode !== 'upgrade') return;
  chooseCard(world, id, playerId);
  audio.play([{ type: 'cardPicked' }], world);
  if (world.phase === 'play') {
    uiMode = 'running';
    acc = 0;
    hideOverlay();
  } else {
    renderUpgrade(); // 还有另一位没选
  }
}

function renderUpgrade() {
  const parts = world.cardChoices.map((ids, i) => {
    const p = world.players[i];
    if (!ids.length) {
      return `<div class="card-col done"><div class="col-title" style="color:${p.color}">${p.name}</div><div class="tag">已选择 / 已倒地</div></div>`;
    }
    const cards = ids
      .map((id, k) => {
        const c = CARDS.find((x) => x.id === id);
        const keys = i === 0 ? ['1', '2', '3'] : ['8', '9', '0'];
        return `<button class="card" type="button" data-id="${id}" data-pid="${p.id}">
          <div class="tag" style="color:${UPGRADE_TAGS[c.tag].color}">${UPGRADE_TAGS[c.tag].label}</div>
          <div class="name">${c.name}</div>
          <div class="desc">${cardText(c, p.stats, world)}</div>
          <div class="key">按 ${keys[k]} 选择</div>
        </button>`;
      })
      .join('');
    return `<div class="card-col"><div class="col-title" style="color:${p.color}">${p.name}</div>${cards}</div>`;
  });
  const twoUp = world.players.length > 1;
  setOverlay(
    `
    <h1>第 <span>${world.wave - 1}</span> 波清空</h1>
    <p class="sub">${twoUp ? '两人各选一个改造（谁先选都行）' : '选一个改造，然后继续往下烧。'}</p>
    <div class="cards ${twoUp ? 'two-up' : ''}">${parts.join('')}</div>
    <p class="hint">${twoUp ? 'P1 按 <b>1 2 3</b> · P2 按 <b>8 9 0</b>' : '按 <b>1 2 3</b> 或点击卡片选择'}</p>
  `,
    { clickable: false }
  );
  ensurePanel()
    .querySelectorAll('.card[data-id]')
    .forEach((el) => {
      el.addEventListener('click', () => pickCard(el.dataset.id, Number(el.dataset.pid)));
    });
  cardIds = world.cardChoices.map((ids) => ids.slice());
}

function showUpgrade() {
  uiMode = 'upgrade';
  renderUpgrade();
}

// ---------- 主循环 ----------
function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.takeSoundToggle()) {
    // M = 总静音：音效和 BGM 一起
    audio.toggle();
    music.toggle();
  }
  if (input.takeMusicToggle()) {
    const on = music.toggle();
    if (on) music.unlock();
  }
  const musicVol = input.takeMusicVolume();
  if (musicVol) music.setVolume(music.volume + musicVol);
  if (input.takeVoiceToggle()) {
    const on = voice.toggle();
    if (on) voice.announce('clear', { now: world.time, force: true });
  }

  if (input.takePause()) {
    if (uiMode === 'running') {
      uiMode = 'paused';
      setOverlay(`<h1>PAUSED</h1><p class="sub">喘口气。</p><p class="hint">按 <b>Esc</b> 或点击这里继续</p>`);
    } else if (uiMode === 'paused') {
      uiMode = 'running';
      hideOverlay();
    }
  }

  for (const code of input.takePressed()) {
    if (code === 'KeyG' && (uiMode === 'running' || uiMode === 'paused')) {
      if (bot.enabled) detachBot();
      else attachBot(true);
      continue;
    }
    if (uiMode === 'title' && (code === 'Enter' || code === 'NumpadEnter')) startRun(1, 'standard');
    else if (uiMode === 'title' && code === 'Tab') startRun(2, 'standard');
    else if (uiMode === 'title' && code === 'KeyX') startRun(1, 'extreme');
    else if (uiMode === 'title' && code === 'KeyC') startRun(2, 'extreme');
    else if (uiMode === 'over' && code === 'KeyR') startRun(world.players.length, world.mode);
    else if (uiMode === 'upgrade') {
      const slot = CARD_KEYS[code];
      if (slot === undefined) continue;
      // 数字键按"谁还空着"分配：1/2/3 永远给 P1，8/9/0 永远给 P2
      const isP2 = ['Digit8', 'Digit9', 'Digit0'].includes(code);
      const targetIndex = isP2 ? 1 : 0;
      const ids = world.cardChoices[targetIndex];
      if (ids?.length && ids[slot]) pickCard(ids[slot], world.players[targetIndex].id);
      else {
        // 那位已经选过了，就把这次按键让给另一位
        const otherSlot = world.cardChoices.findIndex((l) => l.length);
        if (otherSlot >= 0 && world.cardChoices[otherSlot][slot]) {
          pickCard(world.cardChoices[otherSlot][slot], world.players[otherSlot].id);
        }
      }
    }
  }

  if (uiMode === 'running') {
    acc += dt * speed;
    let guard = 0;
    const stepsAllowed = bot.enabled ? 60 : 5;
    while (acc >= STEP && guard < stepsAllowed) {
      let inObj;
      if (bot.enabled) {
        inObj = world.players.map((p, i) => bot.agents[i].think(world, STEP, p));
      } else {
        inObj = input.build(world);
      }
      step(world, inObj, STEP);
      audio.play(world.events, world);
      for (const e of world.events) {
        if (e.type === 'playerHit' && e.id === 1) renderer.hurt(e.damage);
        // 战场播报：只在关键节点出声，避免刷屏
        else if (e.type === 'waveStart' && !bot.enabled) voice.announce('wave', { wave: e.wave, now: world.time });
        else if (e.type === 'waveClear') voice.announce('clear', { now: world.time });
        else if (e.type === 'overheat') voice.announce('overheat', { now: world.time });
        else if (e.type === 'playerDown') voice.announce('down', { now: world.time });
        else if (e.type === 'playerRevived') voice.announce('revive', { now: world.time });
        else if (e.type === 'allDown') voice.announce('lost', { now: world.time, force: true });
        else if (e.type === 'jackpot') voice.announce('jackpot', { now: world.time, force: true });
        else if (e.type === 'bossSpawn') voice.announce('boss', { now: world.time, force: true });
      }
      acc -= STEP;
      guard++;
      if (world.dead) break;
    }
    if (acc > STEP * stepsAllowed) acc = 0;
  }
  audio.update(world, dt);
  music.update({ uiMode, dead: world.dead, boss: world.enemies.some((e) => e.boss) }, dt);

  if (uiMode === 'running' && world.dead) {
    uiMode = 'dying';
    setTimeout(gameOver, 500);
  }
  if (uiMode === 'running' && world.phase === 'upgrade') {
    if (bot.enabled && bot.autoPick) {
      if (bot.cardDelay > 0) bot.cardDelay--;
      else {
        let guard = 0;
        while (world.cardChoices.some((l) => l.length) && guard++ < 4) pickSmartCard(world);
        bot.cardDelay = 3;
      }
    } else showUpgrade();
  }

  renderer.draw(world, { mouse: input.pos, touchStick: input.touchState });
  updateHud();
  hints.update(world);
  hints.updateAudio({
    musicOn: music.enabled,
    musicVolume: music.volume,
    musicLabel: music.trackLabel,
    sfxOn: audio.enabled,
    voiceOn: voice.enabled,
  });
}

function attachBot(autoPick = true) {
  bot.agents = world.players.map((p) => createBot({ seed: world.seed + p.index * 991, index: p.index }));
  bot.enabled = true;
  bot.autoPick = autoPick;
  return true;
}

function detachBot() {
  bot.enabled = false;
  bot.agents.forEach((a) => a.think(world, STEP, world.players[a.cfg.index]));
}

// 交互：点击遮罩 = 开始 / 继续 / 重开
overlay.addEventListener('click', (e) => {
  if (e.target.closest('.card')) return;
  audio.unlock();
  music.unlock();
  if (uiMode === 'title') startRun(1, 'standard');
  else if (uiMode === 'paused') {
    uiMode = 'running';
    hideOverlay();
  } else if (uiMode === 'over') startRun(world.players.length, world.mode);
  else if (uiMode === 'upgrade') skipRemainingCards(world), (uiMode = 'running'), hideOverlay();
});
window.addEventListener('blur', () => {
  if (uiMode === 'running') {
    uiMode = 'paused';
    setOverlay(`<h1>PAUSED</h1><p class="sub">窗口失焦，自动暂停。</p><p class="hint">点击这里继续</p>`);
  }
});

// 部署了新版本、新 Service Worker 接管后，当前页面跑的还是旧 JS（可能出现
// "文件明明改对了、浏览器还在报旧错"）。刷新一次让页面和新缓存对齐。
if ('serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

// 切到别的标签页时停掉音乐（省电，也避免"后台还在响"）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.suspend();
  else music.resume({ uiMode, dead: world.dead, boss: world.enemies.some((e) => e.boss) });
});

// 窄屏把提示面板折到下面的媒体查询里，标题页要额外处理（见 style.css 的 body.title-open）
buildHud();
titleScreen();
requestAnimationFrame(frame);

// URL 参数：方便分享特定玩法 / 直接进游戏
//   ?mode=extreme        极限模式（不回血）
//   ?players=2           本地双人
//   ?autostart=1         跳过标题直接开打
(() => {
  try {
    const q = new URLSearchParams(location.search);
    const wantExtreme = (q.get('mode') ?? '').toLowerCase() === 'extreme';
    const wantPlayers = Number(q.get('players') ?? 1) === 2 ? 2 : 1;
    if (q.get('autostart') === '1' || wantExtreme || wantPlayers === 2) {
      startRun(wantPlayers, wantExtreme ? 'extreme' : 'standard');
    }
  } catch {
    /* 参数不合法就照常显示标题 */
  }
})();

// 注册 Service Worker：可离线玩 + 能"装到桌面"（需要 https 或 localhost）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 不支持就算了，游戏本体不依赖它 */
    });
  });
}

// 调试/自动化钩子：方便用脚本复现对局、抓状态（浏览器里 window.NEON.debug()）
window.NEON = {
  get world() {
    return world;
  },
  get mode() {
    return uiMode;
  },
  get frameNo() {
    return frameCount;
  },
  start: startRun,
  pick: pickCard,
  audio,
  /** 触屏设备判定与摇杆状态（自动化验收要用真触摸事件跑这条路径） */
  get isTouch() {
    return input.isTouch;
  },
  get touchState() {
    return input.touchState;
  },
  music: {
    get enabled() {
      return music.enabled;
    },
    get track() {
      return music.trackLabel;
    },
    toggle: () => music.toggle(),
    setVolume: (v) => music.setVolume(v),
    debug: () => music.debug(),
  },
  voice: {
    get enabled() {
      return voice.enabled;
    },
    toggle: () => voice.toggle(),
    announce: (kind, wave = 0) => voice.announce(kind, { wave, now: world.time, force: true }),
  },
  bot: {
    on: attachBot,
    off: detachBot,
    takeOver() {
      bot.agents.forEach((a) => a.think(world, STEP, world.players[a.cfg.index]));
    },
  },
  setSpeed(v) {
    speed = Math.max(0.1, Math.min(20, Number(v) || 1));
    return speed;
  },
  get speed() {
    return speed;
  },
  /** 调试特殊攻击：procRate=1 每发必触发、0 关闭；不传则恢复默认 0.1% */
  setProcRate(v) {
    world.procRate = v === undefined || v === null ? undefined : Math.max(0, Math.min(1, Number(v)));
    return world.procRate ?? TUNING.jackpotChance;
  },
  /** 手动触发一次红黑超载特效（试听/截图用） */
  forceProc() {
    const p = world.players[0];
    return triggerProc(world, p, { x: p.x, y: p.y });
  },
  /** 调试弹幕：立刻召一个 Boss 到场上（试弹幕/截图用） */
  spawnBoss(wave = Math.max(5, world.wave)) {
    world.wave = wave;
    const at = world.time + 0.05;
    world.spawnQueue.push({ type: 'boss', at, scale: { hp: 1, speed: 1, damage: 1 } });
    return true;
  },
  debug() {
    return {
      mode: uiMode,
      frameCount,
      wave: world.wave,
      phase: world.phase,
      dead: world.dead,
      playerCount: world.players.length,
      kills: world.stats.kills,
      enemies: world.enemies.length,
      bullets: world.bullets.length,
      particles: world.particles.length,
      eBullets: world.eBullets.length,
      boss: (() => {
        const b = world.enemies.find((e) => e.boss);
        return b ? { hp: Math.round(b.hp), hpMax: Math.round(b.hpMax), phase: b.pattern?.phase ?? 0 } : null;
      })(),
      jackpotLife: +world.jackpot.life.toFixed(2),
      procRate: world.procRate ?? 0.001,
      cards: world.cardChoices.map((l) => l.slice()),
      players: world.players.map((p) => ({
        name: p.name,
        hp: Math.round(p.hp),
        hpMax: p.stats.hpMax,
        shield: Math.round(p.shield),
        heat: Math.round(p.heat),
        heatLock: p.heatLock,
        down: p.down,
        kills: p.statsRun.kills,
        jackpots: p.jackpots,
        graze: p.graze,
        grazeCharge: Math.round(p.grazeCharge),
        accuracy: p.statsRun.shots ? +(p.statsRun.hits / p.statsRun.shots).toFixed(3) : 0,
        cards: p.stats.taken.length,
        aim: +p.aim.toFixed(2),
      })),
    };
  },
};
void TUNING;
