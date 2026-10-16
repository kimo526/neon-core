// 极简静态服务器：ES module 在 file:// 下会被 CORS 挡掉，所以走 http://localhost。
//
//   node tools/serve.mjs            # 只听本机 127.0.0.1
//   node tools/serve.mjs 8787 lan   # 同时监听局域网（手机/朋友连同一个 WiFi 就能开）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeQr, qrToText } from '../src/qr.js';

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
  // 音频必须给对 MIME，否则 iOS Safari 会直接拒播
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
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
    const type = TYPES[extname(target)] ?? 'application/octet-stream';

    // ★ 必须支持 Range 请求：iOS Safari 播放音频/视频时强制要求 206 分片，
    //   否则它会一直卡在加载状态（表现为"没声音"）
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
        if (Number.isNaN(start) || start >= body.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
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
    const ips = lanAddresses();
    for (const ip of ips) {
      process.stdout.write(`  局域网： http://${ip}:${port}/   ← 同一个 WiFi 下手机/朋友直接开这个\n`);
    }
    // 终端里印一个二维码：手机相机对着扫一下就进游戏，不用手输 IP
    if (ips.length) {
      const url = `http://${ips[0]}:${port}/`;
      try {
        const qr = encodeQr(url);
        process.stdout.write(`\n  手机扫码直接进（相机对着这个扫）：\n\n`);
        process.stdout.write(
          qrToText(qr, { quiet: 2 })
            .split('\n')
            .map((l) => '  ' + l)
            .join('\n') + '\n\n'
        );
        process.stdout.write(`  ${url}\n`);
      } catch (e) {
        process.stdout.write(`  （二维码生成失败：${e.message}）\n`);
      }
    }
  } else {
    process.stdout.write(`  （想让别人也能连：node tools/serve.mjs ${port} lan）\n`);
  }
  process.stdout.write(`(Ctrl+C 停止)\n`);
});
