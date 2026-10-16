// 手机上截一张游戏中的图（含虚拟摇杆），用来肉眼确认布局与触摸 UI。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:8787/';
const PORT = 9400 + Math.floor(Math.random() * 60);
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'neon-mob-'));
const child = spawn(
  EDGE,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
   '--autoplay-policy=no-user-gesture-required', url],
  { stdio: 'ignore' }
);
const done = (c) => { try { child.kill(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(c); };

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
  if (!page) await sleep(250);
}
if (!page) { console.error('DevTools 没起来'); done(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', () => res(), { once: true });
  ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

for (let i = 0; i < 30; i++) { if (await ev('typeof window.NEON === "object"')) break; await sleep(250); }

// 竖屏手机
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.reload');
await sleep(3500);

// 标题页截图
let shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('C:/tmp/phone-title.png', Buffer.from(shot.result.data, 'base64'));

// 开局并按住摇杆
await ev('window.NEON.start(1, "standard")');
await sleep(2500);
const box = JSON.parse(await ev('JSON.stringify((()=>{const c=document.getElementById("game").getBoundingClientRect();return {x:c.left,y:c.top,w:c.width,h:c.height}})())'));
const lx = box.x + box.w * 0.2, ly = box.y + box.h * 0.72;
const T = (x, y) => ({ x, y, id: 1, radiusX: 14, radiusY: 14, force: 1 });
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [T(lx, ly)] });
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [T(lx + i * 7, ly - i * 7)] });
  await sleep(70);
}
await sleep(1500);
shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('C:/tmp/phone-play.png', Buffer.from(shot.result.data, 'base64'));
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

const st = JSON.parse(await ev('JSON.stringify({touch: window.NEON.isTouch, move: window.NEON.touchState.move, hp: window.NEON.world.players[0].hp, wave: window.NEON.world.wave})'));
console.log('竖屏 390x844:', JSON.stringify(st));
console.log('截图: C:/tmp/phone-title.png  C:/tmp/phone-play.png');
ws.close();
done(0);
