// Service Worker：让游戏能离线玩 / 装到桌面。
// 策略很简单：同源资源一律 cache-first，后台顺手更新（stale-while-revalidate）。
// 这样断网、或者托管在慢速静态站上，第二次打开都是秒进。
const CACHE = 'neon-core-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './assets/icon-512.png',
  './assets/icon-192.png',
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
