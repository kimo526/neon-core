// 一次性验收：在干净的无缓存浏览器配置里，确认线上 BGM 真的在播、会随战况切歌。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'https://kimo526.github.io/neon-core/';
const PORT = 9300 + Math.floor(Math.random() * 60);
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'neon-bgm-'));
const child = spawn(
  EDGE,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
   '--autoplay-policy=no-user-gesture-required', url],
  { stdio: 'ignore' }
);

const done = (code) => {
  try { child.kill(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  process.exit(code);
};

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
  if (!page) await sleep(250);
}
if (!page) { console.error('DevTools 没起来'); done(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', () => res(), { once: true });
  ws.addEventListener('error', () => rej(new Error('ws 失败')), { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

for (let i = 0; i < 30; i++) {
  if (await ev('typeof window.NEON === "object"')) break;
  await sleep(250);
}
await ev(`window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));true`);

// 模拟点标题页（解锁音频的合法手势）
await ev(`(()=>{const o=document.getElementById('overlay');for(const t of ['pointerdown','mousedown','click'])o.dispatchEvent(new MouseEvent(t,{bubbles:true}));return 1})()`);
await sleep(3000);
const menu = JSON.parse(await ev('JSON.stringify(window.NEON.music.debug())'));

await ev('window.NEON.start(1,"standard")');
await sleep(4000);
const g1 = JSON.parse(await ev('JSON.stringify(window.NEON.music.debug())'));
await sleep(3000);
const g2 = JSON.parse(await ev('JSON.stringify(window.NEON.music.debug())'));

await ev('window.NEON.spawnBoss(5)');
await sleep(6000);
const boss = JSON.parse(await ev('JSON.stringify(window.NEON.music.debug())'));
const label = await ev('window.NEON.music.track');
const errs = JSON.parse(await ev('JSON.stringify(window.__errs)'));

const row = (name, d) => {
  const t = d.tracks.theme, b = d.tracks.battle, e = d.tracks.ending;
  return `${name}: 当前=${d.current} | 主题曲(vol=${t?.volume ?? '-'}, ${t?.paused ? '暂停' : '播放中'}, t=${t?.time ?? '-'}) | 战斗曲(vol=${b?.volume ?? '-'}) | 片尾曲(vol=${e?.volume ?? '-'})`;
};
console.log('页面:', url);
console.log(row('标题页', menu));
console.log(row('战斗中', g1));
console.log(row('战斗+3s', g2));
console.log(row('Boss 战', boss), '| 曲名:', label);
console.log('主题曲时间推进:', g1.tracks.theme?.time, '→', g2.tracks.theme?.time, (g2.tracks.theme?.time > g1.tracks.theme?.time) ? '✅' : '❌');
console.log('Boss 切歌:', boss.current === 'battle' && boss.tracks.theme?.volume === 0 ? '✅' : '❌');
console.log('未捕获错误:', errs.length ? '❌ ' + [...new Set(errs)].slice(0, 3).join(' / ') : '✅ 无');

const ok = g2.tracks.theme?.time > g1.tracks.theme?.time && boss.current === 'battle' && errs.length === 0;
console.log(ok ? '\n✅ BGM 线上验收通过' : '\n❌ 有问题');
ws.close();
done(ok ? 0 : 1);
