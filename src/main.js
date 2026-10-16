// 主循环：固定步长 60Hz 推进模拟，渲染跟随屏幕刷新率。
import { STEP, TUNING, UPGRADE_TAGS } from './content.js';
import { chooseCard, createWorld, step } from './sim.js';
import { CARDS, cardText } from './upgrades.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { createBot } from './bot.js';
import { pickCard as pickSmartCard } from './harness.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const panel = overlay.querySelector('.panel');
const input = createInput(canvas);
const renderer = createRenderer(canvas);

const el = (id) => document.getElementById(id);
const hud = {
  wave: el('hud-wave'),
  hp: el('hud-hp'),
  hpBar: el('hud-hp-bar'),
  heat: el('hud-heat'),
  heatBar: el('hud-heat-bar'),
  dash: el('hud-dash'),
  kills: el('hud-kills'),
  time: el('hud-time'),
  weapon: el('hud-weapon'),
};

let world = createWorld((Math.random() * 1e9) | 0);
let mode = 'title'; // title | running | upgrade | over | paused
let acc = 0;
let speed = 1;
let last = performance.now();
let frameCount = 0;
let cardEls = [];
let cardIds = [];
// 数字陪玩：让 AI 接管，方便"看着它自己打"以及截图验收
const bot = { enabled: false, autoPick: true, agent: null, cardDelay: 0 };

function setOverlay(html, { clickable = true, cards = null } = {}) {
  panel.innerHTML = html;
  overlay.classList.toggle('show', true);
  overlay.style.cursor = clickable ? 'pointer' : 'default';
  cardEls = [];
  cardIds = [];
  if (cards) {
    const wrap = panel.querySelector('.cards');
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.type = 'button';
      btn.innerHTML =
        `<div class="tag" style="color:${UPGRADE_TAGS[c.tag].color}">${UPGRADE_TAGS[c.tag].label}</div>` +
        `<div class="name">${c.name}</div>` +
        `<div class="desc">${cardText(c, world.player.stats)}</div>` +
        `<div class="key">按 ${cardEls.length + 1} 选择</div>`;
      btn.addEventListener('click', () => pickCard(c.id));
      wrap.appendChild(btn);
      cardEls.push(btn);
      cardIds.push(c.id);
    }
  }
}

function hideOverlay() {
  overlay.classList.remove('show');
  cardEls = [];
  cardIds = [];
}

function attachBot(autoPick = true) {
  if (!bot.agent) bot.agent = createBot({ seed: world.seed });
  bot.enabled = true;
  bot.autoPick = autoPick;
  return true;
}

function detachBot() {
  bot.enabled = false;
  if (bot.agent) bot.agent.think(world, STEP); // 交还控制权时同步一下朝向
}

function titleScreen() {
  mode = 'title';
  setOverlay(`
    <h1>NEON <span>CORE</span></h1>
    <p class="sub">突入熔炉竞技场，把核心烧穿。</p>
    <ul class="keys">
      <li><b>W A S D</b> 移动</li>
      <li><b>鼠标</b> 瞄准 &nbsp;/&nbsp; <b>左键</b> 射击</li>
      <li><b>空格</b> 冲刺（无敌帧，穿敌）</li>
      <li><b>1</b> 游侠脉冲 &nbsp;/&nbsp; <b>2</b> 重锤霰射</li>
      <li><b>1 2 3</b> 选择强化 &nbsp;/&nbsp; <b>Esc</b> 暂停</li>
    </ul>
    <p class="hint">热量满了会自动锁枪 —— <b>想降温必须松开扳机</b></p>
    <p class="hint">按 <b>回车</b> 或点击这里开始 &nbsp;·&nbsp; 打不过就按 <b>G</b> 让 AI 替你打</p>
  `);
}

function startRun() {
  world = createWorld((Math.random() * 1e9) | 0);
  input.clear();
  acc = 0;
  mode = 'running';
  bot.agent = createBot({ seed: world.seed });
  hideOverlay();
}

function gameOver() {
  mode = 'over';
  const s = world.stats;
  const acc2 = s.shots ? ((s.hits / s.shots) * 100).toFixed(0) : '0';
  const cards = world.player.stats.taken
    .map((id) => CARDS.find((c) => c.id === id)?.name ?? id)
    .join(' · ') || '（一个都没捡）';
  setOverlay(`
    <h1>CORE <span>LOST</span></h1>
    <p class="sub">核心在第 ${world.wave} 波被打穿。</p>
    <ul class="keys">
      <li><b>存活</b> ${s.timeAlive.toFixed(1)} 秒 &nbsp; <b>击杀</b> ${s.kills} &nbsp; <b>清波</b> ${s.waves}</li>
      <li><b>命中率</b> ${acc2}% &nbsp; <b>射出</b> ${s.shots} 发</li>
      <li><b>强化</b> ${cards}</li>
    </ul>
    <p class="hint">按 <b>R</b> 或点击这里重开</p>
  `);
}

function pickCard(id) {
  if (mode !== 'upgrade') return;
  chooseCard(world, id);
  mode = 'running';
  acc = 0;
  hideOverlay();
}

function showUpgrade() {
  mode = 'upgrade';
  const cards = world.cardChoices.map((id) => CARDS.find((c) => c.id === id)).filter(Boolean);
  setOverlay(
    `
    <h1>第 <span>${world.wave - 1}</span> 波清空</h1>
    <p class="sub">选一个改造，然后继续往下烧。</p>
    <div class="cards"></div>
    <p class="hint">按 <b>1</b> <b>2</b> <b>3</b> 或点击卡片选择</p>
  `,
    { cards }
  );
}

function updateHud() {
  const p = world.player;
  const st = p.stats;
  hud.wave.textContent = world.wave;
  hud.hp.textContent = Math.max(0, Math.ceil(p.hp));
  hud.hpBar.style.transform = `scaleX(${Math.max(0, Math.min(1, p.hp / st.hpMax))})`;
  const heatRatio = Math.min(1, p.heat / st.heatMax);
  hud.heat.textContent = world.heatLock ? 'OVERHEAT' : `${Math.round(heatRatio * 100)}%`;
  hud.heat.classList.toggle('warn', world.heatLock || heatRatio > 0.75);
  hud.heatBar.style.transform = `scaleX(${heatRatio})`;
  hud.dash.textContent = p.dashCd > 0 ? `${p.dashCd.toFixed(2)}s` : p.charges > 0 ? 'READY' : 'COOL';
  hud.dash.classList.toggle('warn', p.dashCd > 0);
  hud.kills.textContent = world.stats.kills;
  hud.time.textContent = `${world.stats.timeAlive.toFixed(1)}s`;
  hud.weapon.textContent = st.weapon === 'heavy' ? '重锤霰射' : '游侠脉冲';
}

// ---- 主循环 ----
function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // 暂停/重开快捷键
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
    if (mode === 'title' && (code === 'Enter' || code === 'NumpadEnter')) startRun();
    else if (mode === 'over' && code === 'KeyR') startRun();
    else if (mode === 'upgrade') {
      const idx = { Digit1: 0, Digit2: 1, Digit3: 2 }[code];
      if (idx !== undefined && cardIds[idx]) pickCard(cardIds[idx]);
    }
  }

  const before = {
    hp: world.player.hp,
    phase: world.phase,
    dead: world.dead,
  };
  void before;

  if (mode === 'running') {
    acc += dt * speed;
    let guard = 0;
    const stepsAllowed = bot.enabled ? 60 : 5;
    while (acc >= STEP && guard < stepsAllowed) {
      const inObj = bot.enabled && bot.agent ? bot.agent.think(world, STEP) : input.build(world, STEP);
      step(world, inObj, STEP);
      for (const e of world.events) {
        if (e.type === 'playerHit') renderer.hurt(e.damage);
      }
      acc -= STEP;
      guard++;
      if (world.dead) break;
    }
    if (acc > STEP * stepsAllowed) acc = 0;
  }

  if (mode === 'running' && world.dead) {
    mode = 'dying';
    setTimeout(gameOver, 420);
  }
  if (mode === 'running' && world.phase === 'upgrade') {
    if (bot.enabled && bot.autoPick) {
      if (bot.cardDelay > 0) bot.cardDelay--;
      else if (!pickSmartCard(world)) pickCard(world.cardChoices[0]);
      bot.cardDelay = 3;
    } else {
      showUpgrade();
    }
  }

  renderer.draw(world, { mouse: input.pos });
  updateHud();
}

// 交互：点击遮罩 = 开始 / 继续 / 重开
overlay.addEventListener('click', () => {
  if (mode === 'title') startRun();
  else if (mode === 'paused') {
    mode = 'running';
    hideOverlay();
  } else if (mode === 'over') startRun();
});
window.addEventListener('blur', () => {
  if (mode === 'running') {
    mode = 'paused';
    setOverlay(`<h1>PAUSED</h1><p class="sub">窗口失焦，自动暂停。</p><p class="hint">点击这里继续</p>`);
  }
});

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
  bot: {
    /** 让 AI 接管：可无人值守地打完整局 */
    on: attachBot,
    off: detachBot,
    takeOver() {
      if (bot.agent) bot.agent.think(world, 1 / 60);
    },
  },
  /** 加速倍率：2 = 双倍速推进模拟，用来快速看到后面的波次 */
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
      hp: Math.round(world.player.hp),
      heat: Math.round(world.player.heat),
      heatLock: world.heatLock,
      dead: world.dead,
      enemies: world.enemies.length,
      bullets: world.bullets.length,
      particles: world.particles.length,
      kills: world.stats.kills,
      shots: world.stats.shots,
      hits: world.stats.hits,
      timeAlive: Number(world.stats.timeAlive.toFixed(2)),
      phase: world.phase,
      cards: world.cardChoices,
    };
  },
};
