// 连接探测器：同时在几个端口上监听，把任何进来的连接都打到日志里。
//
// 用途：手机连不上时，用它区分两种情况 ——
//   A. 日志里有手机的连接记录 → 网络通了，问题在应用层（端口/服务）
//   B. 日志里什么都没有       → 数据包根本没到这台电脑（防火墙拦了，或路由器隔离了设备）
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { appendFileSync, writeFileSync } from 'node:fs';

const LOG = 'C:/tmp/neon-probe.log';
const PORTS = [8787, 8799, 8899, 9000];
writeFileSync(LOG, `NEON 连接探测器启动 ${new Date().toLocaleString()}\n`);

function log(line) {
  const msg = `[${new Date().toLocaleTimeString()}] ${line}`;
  console.log(msg);
  try {
    appendFileSync(LOG, msg + '\n');
  } catch {
    /* 无所谓 */
  }
}

function lanIps() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

const ips = lanIps();
log(`本机局域网 IP：${ips.join(', ')}`);
log(`准备监听的端口：${PORTS.join(', ')}`);

for (const port of PORTS) {
  const server = createServer((req, res) => {
    log(`★ 收到 HTTP 请求  port=${port}  from=${req.socket.remoteAddress}  url=${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`NEON 探测器收到连接了！port=${port}\n你的地址：${req.socket.remoteAddress}\n`);
  });
  server.on('connection', (sock) => {
    log(`· TCP 连接建立  port=${port}  from=${sock.remoteAddress}`);
  });
  server.on('error', (err) => log(`端口 ${port} 监听失败：${err.code} ${err.message}`));
  server.listen(port, '0.0.0.0', () => log(`正在监听 0.0.0.0:${port}`));
}

log('');
log('=== 现在用手机浏览器打开下面任意一个地址 ===');
for (const ip of ips) {
  for (const port of PORTS) log(`    http://${ip}:${port}/`);
}
log('=== 如果这里刷出了日志，说明网络是通的；一条都没有就是半路被拦了 ===');
log('');

// 顺便看看 ARP 表里有哪些设备（有可能认出手机）
setTimeout(() => {
  log('（按 Ctrl+C 停止）');
}, 500);
