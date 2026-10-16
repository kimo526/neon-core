// Service Worker：让游戏能离线玩 / 装到桌面。
// 策略：stale-while-revalidate —— 先给缓存（秒开），同时后台拉新版更新缓存。
//
// ★ 改了 src/ 下任何文件，必须把 CACHE 的版本号 +1，否则老玩家会一直拿到旧代码。
const CACHE = 'neon-core-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './assets/icon-512.png',
  './assets/icon-192.png',
  // BGM：离线也要能听（首次加载后会缓存，之后断网可播）
  './assets/music/theme.mp3',
  './assets/music/battle.mp3',
  './assets/music/ending.mp3',
  './src/main.js',
  './src/sim.js',
  './src/content.js',
  './src/upgrades.js',
  './src/patterns.js',
  './src/bot.js',
  './src/harness.js',
  './src/render.js',
  './src/input.js',
  './src/audio.js',
  './src/voice.js',
  './src/hints.js',
  './src/qr.js',
  './src/music.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 不碰第三方请求

  e.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit ?? fetching;
    })
  );
});
