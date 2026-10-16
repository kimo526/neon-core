// 模块加载检查：把页面在无头浏览器里跑起来，确认
//   1) 所有 src/*.js 都能加载、没有语法/引用错误
//   2) 主循环真的在推进（画面在动）
//   3) 侧栏面板真的渲染出了内容
//
// 为什么需要它：Node 侧的单元测试只覆盖纯逻辑，碰不到 DOM 模块。
// 曾经有个 `built is not defined`（闭包变量写错位置）就是这样溜到线上的 ——
// 单元测试全绿，但游戏画面完全不动。
//
// 用法：node tools/check-modules.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.NEON_PORT ?? 8787);
const DEBUG_PORT = 9280 + Math.floor(Math.random() * 40);
const url = process.argv[2] ?? `http://127.0.0.1:${PORT}/`;

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!EDGE) {
  console.error('找不到 Edge');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'neon-check-'));
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,760',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      // 关键：让页面自己把未捕获错误攒进 window.__errs，脚本一定能读到
      '--js-flags=--expose-gc',
      url,
    ],
    { stdio: 'ignore' }
  );
  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 无所谓 */
    }
  };
  process.on('exit', cleanup);
  const bail = setTimeout(() => {
    console.error('[check] 超时');
    cleanup();
    process.exit(1);
  }, 40000);
  bail.unref?.();

  const listTargets = async () => {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
    return res.json();
  };
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    try {
      page = (await listTargets()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 还没起来 */
    }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('DevTools 没就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const msgId = ++id;
      const timer = setTimeout(() => {
        pending.delete(msgId);
        rej(new Error(`CDP 无响应: ${method}`));
      }, 8000);
      pending.set(msgId, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  });
  await new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res();
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', () => rej(new Error('WebSocket 失败')), { once: true });
    setTimeout(() => rej(new Error('连接超时')), 5000);
  });

  // 等模块加载完成；error 收集器尽早装上
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error(`页面里报错: ${r.exceptionDetails.text}`);
    return r.result?.value;
  };
  await evalJs(`
    window.__errs = window.__errs || [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason)));
    true
  `);

  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = await evalJs('typeof window.NEON === "object" && !!window.NEON.debug');
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error('window.NEON 一直没出现 —— 模块加载失败');

  const problems = [];

  // 1) 抓未捕获的错误
  const errs = JSON.parse(await evalJs('JSON.stringify(window.__errs || [])'));
  problems.push(...errs.map((e) => `未捕获错误: ${e}`));

  // 2) 主循环是否在推进
  const f1 = await evalJs('window.NEON.frameNo');
  await sleep(1200);
  const f2 = await evalJs('window.NEON.frameNo');
  if (!(f2 > f1)) problems.push(`主循环没在跑：frameNo ${f1} → ${f2}`);

  // 3) 侧栏面板内容
  const hintsText = await evalJs('(document.getElementById("hints")||{}).innerText || ""');
  if (!/操作提示/.test(hintsText)) problems.push('侧栏面板没渲染出「操作提示」');
  if (!/音频/.test(hintsText)) problems.push('侧栏缺少「音频」区块');

  // 4) 开一局：看逻辑是否推进（时间/敌人在动）
  const before = JSON.parse(await evalJs('JSON.stringify(window.NEON.debug())'));
  await evalJs('window.NEON.start(1, "standard")');
  await sleep(2500);
  const after = JSON.parse(await evalJs('JSON.stringify(window.NEON.debug())'));
  const errs2 = JSON.parse(await evalJs('JSON.stringify(window.__errs || [])'));
  problems.push(...errs2.map((e) => `开局后报错: ${e}`));
  if (!(after.frameCount > before.frameCount)) problems.push('开局后主循环停了');
  if (after.wave < 1) problems.push('开局后波次异常');

  console.log(`[check] 页面: ${url}`);
  console.log(`[check] 帧数推进: ${f1} → ${f2} → ${after.frameCount}`);
  console.log(`[check] 开局状态: wave=${after.wave} 玩家=${after.players.length} 敌人=${after.enemies}`);
  console.log(`[check] 侧栏区块: ${/音频/.test(hintsText) ? '含音频' : '缺音频'} / ${/操作提示/.test(hintsText) ? '含操作提示' : '缺操作提示'}`);
  if (problems.length) {
    console.log(`\n[check] ❌ 发现 ${problems.length} 个问题：`);
    for (const p of [...new Set(problems)].slice(0, 8)) console.log('   - ' + p);
    clearTimeout(bail);
    ws.close();
    cleanup();
    process.exit(1);
  }
  console.log('\n[check] ✅ 模块加载与主循环正常');
  clearTimeout(bail);
  ws.close();
  cleanup();
  process.exit(0);
}

main().catch((err) => {
  console.error('[check] 失败:', err.message);
  process.exit(1);
});
