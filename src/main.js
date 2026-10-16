// 主循环：固定步长 60Hz 推进模拟，渲染跟随屏幕刷新率。
import { STEP, TUNING, UPGRADE_TAGS } from './content.js';
import { chooseCard, createWorld, skipRemainingCards, step } from './sim.js';
import { CARDS, cardText } from './upgrades.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';
import { createBot } from './bot.js';
import { pickCard as pickSmartCard } from './harness.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const panel = overlay.querySelector('.panel');
const hudRoot = document.getElementById('hud');
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const audio = createAudio();
// 机器人播报：共用音频引擎的上下文与总线
const voice = createVoice(
  () => audio.context,
  () => audio.bus
);

const CARD_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit8: 0, Digit9: 1, Digit0: 2 };

let world = createWorld((Math.random() * 1e9) | 0, { playerCount: 1 });
let mode = 'title'; // title | running | upgrade | over | paused | dying
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
      <div class="row"><span class="label">HP</span><span class="value hp">100</span></div>
      <div class="bar"><i class="hpbar"></i></div>
      <div class="row"><span class="label">HEAT</span><span class="value heat">0%</span></div>
      <div class="bar"><i class="heatbar"></i></div>
      <div class="row"><span class="label">DASH</span><span class="value dash">READY</span></div>
      <div class="row"><span class="label">WEAPON</span><span class="value weapon">游侠脉冲</span></div>
      <div class="row"><span class="label">KILLS</span><span class="value kills">0</span></div>
      <div class="row"><span class="label">TIME</span><span class="value time">0.0s</span></div>
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
  });
}

// ---------- 遮罩层 ----------
function setOverlay(html, { clickable = true } = {}) {
  panel.innerHTML = html;
  overlay.classList.add('show');
  overlay.style.cursor = clickable ? 'pointer' : 'default';
}

function hideOverlay() {
  overlay.classList.remove('show');
  cardIds = [[]];
}

function titleScreen() {
  mode = 'title';
  setOverlay(`
    <h1>NEON <span>CORE</span></h1>
    <p class="sub">突入熔炉竞技场，把核心烧穿。</p>
    <ul class="keys">
      <li><b>单人</b>：WASD 移动 · 鼠标瞄准 · 左键射击 · 空格冲刺</li>
      <li><b>双人 P1</b>：WASD + 鼠标 + 左键 + 空格</li>
      <li><b>双人 P2</b>：<b>I J K L</b> 移动 · <b>方向键</b> 瞄准 · <b>分号 ;</b> 射击 · <b>回车</b> 冲刺</li>
      <li>武器：<b>1</b>/<b>2</b>（P1）· <b>8</b>/<b>9</b>（P2） &nbsp;|&nbsp; 强化卡：<b>1 2 3</b>（P1）· <b>8 9 0</b>（P2）</li>
      <li><b>Esc</b> 暂停 &nbsp;·&nbsp; <b>M</b> 静音 &nbsp;·&nbsp; <b>V</b> 机器人播报 &nbsp;·&nbsp; <b>G</b> AI 托管</li>
    </ul>
    <p class="hint">热量满了会自动锁枪 —— <b>想降温必须松开扳机</b></p>
    <p class="hint">按 <b>回车</b> 单人 &nbsp;·&nbsp; 按 <b>Tab</b> 本地双人 &nbsp;·&nbsp; 或点击这里单人开始</p>
  `);
}

function startRun(playerCount = 1) {
  world = createWorld((Math.random() * 1e9) | 0, { playerCount });
  input.clear();
  audio.unlock();
  acc = 0;
  mode = 'running';
  buildHud();
  bot.agents = world.players.map((p) => createBot({ seed: world.seed + p.index * 991, index: p.index }));
  hideOverlay();
}

function gameOver() {
  mode = 'over';
  const rows = world.players
    .map((p) => {
      const acc2 = p.statsRun.shots ? ((p.statsRun.hits / p.statsRun.shots) * 100).toFixed(0) : '0';
      const cards = p.stats.taken.map((id) => CARDS.find((c) => c.id === id)?.name ?? id).join(' · ') || '（一个都没捡）';
      return `<li><b style="color:${p.color}">${p.name}</b> 击杀 ${p.statsRun.kills} · 伤害 ${Math.round(p.statsRun.damage)} · 命中率 ${acc2}% · 存活 ${p.statsRun.timeAlive.toFixed(0)}s<br><span class="dim">${cards}</span></li>`;
    })
    .join('');
  setOverlay(`
    <h1>CORE <span>LOST</span></h1>
    <p class="sub">核心在第 ${world.wave} 波被打穿。</p>
    <ul class="keys score">${rows}</ul>
    <p class="hint">合计击杀 <b>${world.stats.kills}</b> · 清波 <b>${world.stats.waves}</b></p>
    <p class="hint">按 <b>R</b> 或点击这里重开（沿用 ${world.players.length} 人）</p>
  `);
}

function pickCard(id, playerId) {
  if (mode !== 'upgrade') return;
  chooseCard(world, id, playerId);
  audio.play([{ type: 'cardPicked' }], world);
  if (world.phase === 'play') {
    mode = 'running';
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
          <div class="desc">${cardText(c, p.stats)}</div>
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
  panel.querySelectorAll('.card[data-id]').forEach((el) => {
    el.addEventListener('click', () => pickCard(el.dataset.id, Number(el.dataset.pid)));
  });
  cardIds = world.cardChoices.map((ids) => ids.slice());
}

function showUpgrade() {
  mode = 'upgrade';
  renderUpgrade();
}

// ---------- 主循环 ----------
function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.takeSoundToggle()) audio.toggle();
  if (input.takeVoiceToggle()) {
    const on = voice.toggle();
    if (on) voice.announce('clear', { now: world.time, force: true });
  }

  if (input.takePause()) {
    if (mode === 'running') {
      mode = 'paused';
      setOverlay(`<h1>PAUSED</h1><p class="sub">喘口气。</p><p class="hint">按 <b>Esc</b> 或点击这里继续</p>`);
    } else if (mode === 'paused') {
      mode = 'running';
      hideOverlay();
    }
  }

  for (const code of input.takePressed()) {
    if (code === 'KeyG' && (mode === 'running' || mode === 'paused')) {
      if (bot.enabled) detachBot();
      else attachBot(true);
      continue;
    }
    if (mode === 'title' && (code === 'Enter' || code === 'NumpadEnter')) startRun(1);
    else if (mode === 'title' && code === 'Tab') startRun(2);
    else if (mode === 'over' && code === 'KeyR') startRun(world.players.length);
    else if (mode === 'upgrade') {
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

  if (mode === 'running') {
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
      }
      acc -= STEP;
      guard++;
      if (world.dead) break;
    }
    if (acc > STEP * stepsAllowed) acc = 0;
  }
  audio.update(world, dt);

  if (mode === 'running' && world.dead) {
    mode = 'dying';
    setTimeout(gameOver, 500);
  }
  if (mode === 'running' && world.phase === 'upgrade') {
    if (bot.enabled && bot.autoPick) {
      if (bot.cardDelay > 0) bot.cardDelay--;
      else {
        let guard = 0;
        while (world.cardChoices.some((l) => l.length) && guard++ < 4) pickSmartCard(world);
        bot.cardDelay = 3;
      }
    } else showUpgrade();
  }

  renderer.draw(world, { mouse: input.pos });
  updateHud();
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
  if (mode === 'title') startRun(1);
  else if (mode === 'paused') {
    mode = 'running';
    hideOverlay();
  } else if (mode === 'over') startRun(world.players.length);
  else if (mode === 'upgrade') skipRemainingCards(world), (mode = 'running'), hideOverlay();
});
window.addEventListener('blur', () => {
  if (mode === 'running') {
    mode = 'paused';
    setOverlay(`<h1>PAUSED</h1><p class="sub">窗口失焦，自动暂停。</p><p class="hint">点击这里继续</p>`);
  }
});

buildHud();
titleScreen();
requestAnimationFrame(frame);

// 调试/自动化钩子：方便用脚本复现对局、抓状态（浏览器里 window.NEON.debug()）
window.NEON = {
  get world() {
    return world;
  },
  get mode() {
    return mode;
  },
  get frameNo() {
    return frameCount;
  },
  start: startRun,
  pick: pickCard,
  audio,
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
  debug() {
    return {
      mode,
      frameCount,
      wave: world.wave,
      phase: world.phase,
      dead: world.dead,
      playerCount: world.players.length,
      kills: world.stats.kills,
      enemies: world.enemies.length,
      bullets: world.bullets.length,
      particles: world.particles.length,
      cards: world.cardChoices.map((l) => l.slice()),
      players: world.players.map((p) => ({
        name: p.name,
        hp: Math.round(p.hp),
        hpMax: p.stats.hpMax,
        heat: Math.round(p.heat),
        heatLock: p.heatLock,
        down: p.down,
        kills: p.statsRun.kills,
        accuracy: p.statsRun.shots ? +(p.statsRun.hits / p.statsRun.shots).toFixed(3) : 0,
        cards: p.stats.taken.length,
        aim: +p.aim.toFixed(2),
      })),
    };
  },
};
void TUNING;
