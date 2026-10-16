// 无头验收工具：用 Edge 的 DevTools 协议开页面、模拟按键/鼠标、截图。
// 为什么不用现成的 Playwright：这台机器没装，而 Node 自带 WebSocket，
// 走 CDP 零依赖就能拿到"真正渲染出来的画面"。
//
// 用法：
//   node tools/headless.mjs                       # 单人自动打 12 秒 → headless-solo.png
//   node tools/headless.mjs coop 14               # 双人自动打 14 秒 → headless-coop.png
//   node tools/headless.mjs coop 14 --keep-open   # 打完后不关浏览器（方便手动接着玩）
//   node tools/headless.mjs solo 8 --proc         # 强制特殊攻击触发，专截红黑特效
//   node tools/headless.mjs solo 8 --proc=0.05    # 指定触发率，实测特效频率
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mode = process.argv[2] === 'coop' ? 'coop' : 'solo';
const seconds = Number(process.argv[3] ?? 12);
const keepOpen = process.argv.includes('--keep-open');
const procArg = process.argv.find((a) => a === '--proc' || a.startsWith('--proc='));
const procRate = procArg ? (procArg.includes('=') ? Number(procArg.split('=')[1]) : 1) : null;
const wantBoss = process.argv.includes('--boss');
const PORT = Number(process.env.NEON_PORT ?? 8787);
const DEBUG_PORT = 9222 + (mode === 'coop' ? 1 : 0);
const OUT = join(root, `headless-${mode}${procRate !== null ? '-proc' : wantBoss ? '-boss' : ''}.png`);

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : null,
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findEdge() {
  const hit = EDGE_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    console.error('找不到 Edge，请手动指定：设置环境变量 EDGE_PATH 或改 EDGE_CANDIDATES');
    process.exit(2);
  }
  return hit;
}

async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('DevTools 端口没就绪');
}

function connect(url) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () =>
      resolvePromise({
        send(method, params = {}) {
          const msgId = ++id;
          ws.send(JSON.stringify({ id: msgId, method, params }));
          return new Promise((res, rej) => pending.set(msgId, { res, rej }));
        },
        close: () => ws.close(),
      })
    );
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket 出错: ${e.message ?? 'unknown'}`)));
  });
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'neon-cdp-'));
  const edge = findEdge();

  const child = spawn(
    edge,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,760',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      '--autoplay-policy=no-user-gesture-required',
      `http://127.0.0.1:${PORT}/`,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    if (!keepOpen) {
      try {
        child.kill();
      } catch {
        /* 已经退了 */
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* 无所谓 */
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const target = await cdpTargets();
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  // 收集页面报错，任何一条都算验收失败
  const errors = [];
  await client.send('Runtime.addBinding', { name: '__neonReport' }).catch(() => {});
  const poll = setInterval(async () => {
    try {
      const r = await client.send('Runtime.evaluate', {
        expression: `(() => { window.__errs = window.__errs || []; return JSON.stringify(window.__errs); })()`,
        returnByValue: true,
      });
      if (r.result?.value) {
        const list = JSON.parse(r.result.value);
        for (const e of list) if (!errors.includes(e)) errors.push(e);
      }
    } catch {
      /* 页面可能正在导航 */
    }
  }, 800);

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result?.value;
  };

  // 等游戏脚本起来
  for (let i = 0; i < 40; i++) {
    const ok = await evalJs('typeof window.NEON === "object" && typeof window.NEON.start === "function"');
    if (ok) break;
    await sleep(250);
  }
  await evalJs('window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message))); true');

  // 开局：单人 / 双人，然后交给 AI 托管（这样画面里一定有人在打）
  await evalJs(`window.NEON.start(${mode === 'coop' ? 2 : 1}); window.NEON.bot.on(true); window.NEON.setSpeed(2); true`);
  if (procRate !== null) {
    await evalJs(`window.NEON.setProcRate(${procRate}); true`);
    console.error(`[headless] 特殊攻击触发率临时设为 ${(procRate * 100).toFixed(2)}%`);
  }
  if (wantBoss) {
    await evalJs('window.NEON.spawnBoss(5); window.NEON.setSpeed(1); true');
    console.error('[headless] 已召出弹幕 Boss');
  }
  console.error(`[headless] ${mode} 模式开打，跑 ${seconds}s ...`);

  const t0 = Date.now();
  let shotForProc = false;
  let peakEBullets = 0;
  while ((Date.now() - t0) / 1000 < seconds) {
    await sleep(procRate !== null ? 120 : wantBoss ? 250 : 1000);
    const d = await evalJs('JSON.stringify(window.NEON.debug())');
    const s = JSON.parse(d);
    peakEBullets = Math.max(peakEBullets, s.eBullets ?? 0);
    if (procRate === null && !wantBoss) {
      console.error(
        `[headless] t=${((Date.now() - t0) / 1000).toFixed(0)}s wave=${s.wave} kills=${s.kills} 玩家=${s.players
          .map((p) => `${p.name}:hp${p.hp}${p.down ? '(DOWN)' : ''}`)
          .join(' ')}`
      );
    }
    // 特效正在播放的那一瞬间截图，别等它结束
    if (procRate !== null && !shotForProc && s.jackpotLife > 0.15) {
      shotForProc = true;
      console.error(`[headless] 捕获到超载特效（剩余 ${s.jackpotLife}s），立即截图`);
      break;
    }
    // 弹幕最密的时候截图，这样才看得到"东方那味"
    if (wantBoss && !shotForProc && (s.eBullets ?? 0) >= 55) {
      shotForProc = true;
      console.error(`[headless] 弹幕密度到 ${s.eBullets} 发，立即截图`);
      break;
    }
    if (s.mode === 'over') {
      console.error('[headless] 团灭，提前截图');
      break;
    }
  }

  const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  const final = JSON.parse(await evalJs('JSON.stringify(window.NEON.debug())'));
  clearInterval(poll);

  console.error(`\n[headless] 截图已保存: ${OUT}`);
  console.error(`[headless] 终局: ${JSON.stringify(final.players)}`);
  console.error(`[headless] 弹幕峰值: ${peakEBullets} 发`);
  if (errors.length) {
    console.error(`[headless] ❌ 页面报错 ${errors.length} 条:`);
    for (const e of errors.slice(0, 5)) console.error('   - ' + e);
  } else {
    console.error('[headless] ✅ 无页面报错');
  }

  client.close();
  cleanup();
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[headless] 失败:', err.message);
  process.exit(1);
});
