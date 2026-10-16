// 极简静态服务器：ES module 在 file:// 下会被 CORS 挡掉，所以走 http://localhost。
//
//   node tools/serve.mjs            # 只听本机 127.0.0.1
//   node tools/serve.mjs 8787 lan   # 同时监听局域网（手机/朋友连同一个 WiFi 就能开）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 8787);
const lan = process.argv.includes('lan') || process.env.NEON_LAN === '1';
const host = lan ? '0.0.0.0' : '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const target = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: path + '/' }).end();
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.message ?? err));
  }
});

/** 找出本机所有可用的局域网 IPv4 地址（用来告诉用户"发给朋友这个链接"） */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(port, host, () => {
  process.stdout.write(`NEON CORE 已启动\n`);
  process.stdout.write(`  本机：   http://127.0.0.1:${port}/\n`);
  if (lan) {
    for (const ip of lanAddresses()) {
      process.stdout.write(`  局域网： http://${ip}:${port}/   ← 同一个 WiFi 下手机/朋友直接开这个\n`);
    }
  } else {
    process.stdout.write(`  （想让别人也能连：node tools/serve.mjs ${port} lan）\n`);
  }
  process.stdout.write(`(Ctrl+C 停止)\n`);
});
