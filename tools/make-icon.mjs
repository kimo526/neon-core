// 生成 PWA 图标（512×512 PNG），零依赖：自己画 + 自己编码 PNG。
//
// 为什么不用无头浏览器栅格化 SVG：Edge 在无头模式下对 file:// 解析、target 切换都很不稳定，
// 为了一个静态图标不值得。手写 PNG 编码器反而更短、更快、可复现。
//
// 用法：node tools/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SIZE = 512;
const OUT_DIR = join(root, 'assets');
const OUT = join(OUT_DIR, 'icon-512.png');

// ---------- 微型画布 ----------
const px = new Uint8Array(SIZE * SIZE * 4); // RGBA

const hex = (h) => {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 把颜色按 alpha 混到像素上（source-over） */
function blend(x, y, [r, g, b], a) {
  if (a <= 0 || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const sa = Math.min(1, a);
  const da = px[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / outA);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / outA);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

/** 带抗锯齿的"按到形状里"：用 3×3 超采样估覆盖率 */
function fillShape(test, color, alpha = 1) {
  const [r, g, b] = hex(color);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
        }
      }
      if (hits) blend(x, y, [r, g, b], (hits / 9) * alpha);
    }
  }
}

const roundedRect = (x0, y0, x1, y1, radius) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
};

const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r, w) => (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r + w / 2 && d >= r - w / 2;
};

/** 凸多边形（用于机甲箭头） */
function polygon(points) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** 把本地坐标的多边形旋转后平移到画布 */
const rot = (pts, deg, tx, ty) => {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map(([x, y]) => [x * cos - y * sin + tx, x * sin + y * cos + ty]);
};

// ---------- 画图标 ----------
// 底：近似径向渐变（用几层同心圆叠出来）
fillShape(roundedRect(0, 0, SIZE - 1, SIZE - 1, 96), '#04060b');
for (let i = 12; i >= 1; i--) {
  const k = i / 12;
  fillShape(circle(256, 205, 300 * k), k > 0.5 ? '#0d1728' : '#0a1220', 0.5);
}
fillShape(roundedRect(14, 14, SIZE - 15, SIZE - 15, 84), '#1d3852', 0.55);
fillShape(roundedRect(18, 18, SIZE - 19, SIZE - 19, 80), '#04060b');

// 网格
for (let i = 0; i < 9; i++) {
  const p = 64 + i * 48;
  fillShape((x, y) => Math.abs(x - p) < 1 && y > 60 && y < 452, '#4ff0ff', 0.07);
  fillShape((x, y) => Math.abs(y - p) < 1 && x > 60 && x < 452, '#4ff0ff', 0.07);
}

// 冲刺残影（从弱到强）
fillShape(circle(120, 392, 26), '#8affc1', 0.14);
fillShape(circle(152, 366, 22), '#8affc1', 0.22);
fillShape(circle(182, 344, 18), '#8affc1', 0.32);

// 三色弹幕
for (const [cx, cy, r, col] of [
  [392, 120, 17, '#c96bff'],
  [150, 140, 15, '#ff5c8a'],
  [418, 330, 13, '#ff7a4d'],
]) {
  fillShape(circle(cx, cy, r), col);
  fillShape(circle(cx, cy, r * 0.42), '#ffffff');
}

// 机甲：外圈判定环 + 箭头 + 核心
fillShape(ring(256, 268, 104, 5), '#4ff0ff', 0.22);
const arrow = rot(
  [
    [96, 0],
    [-58, 62],
    [-22, 0],
    [-58, -62],
  ],
  -38,
  256,
  268
);
fillShape(polygon(arrow), '#0b1c26');
// 描边：把箭头放大一点画青色，再盖上内层，得到"描边"效果
const arrowEdge = rot(
  [
    [104, 0],
    [-64, 70],
    [-24, 0],
    [-64, -70],
  ],
  -38,
  256,
  268
);
fillShape(polygon(arrowEdge), '#7ff4ff');
fillShape(polygon(arrow), '#0b1c26');
fillShape(circle(256 + Math.cos((-38 * Math.PI) / 180) * 20, 268 + Math.sin((-38 * Math.PI) / 180) * 20, 15), '#eafcff');

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const png = encodePng(px, SIZE);
writeFileSync(OUT, png);

// 同时导出一张 192 的（有些平台要小图，它们会自己缩，但给一张更稳）
const SMALL = 192;
const small = new Uint8Array(SMALL * SMALL * 4);
for (let y = 0; y < SMALL; y++) {
  for (let x = 0; x < SMALL; x++) {
    // 简单盒式降采样
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    const step = SIZE / SMALL;
    for (let sy = 0; sy < step; sy++) {
      for (let sx = 0; sx < step; sx++) {
        const i = ((Math.floor(y * step + sy) * SIZE) + Math.floor(x * step + sx)) * 4;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
        a += px[i + 3];
      }
    }
    const n = step * step;
    const i = (y * SMALL + x) * 4;
    small[i] = Math.round(r / n);
    small[i + 1] = Math.round(g / n);
    small[i + 2] = Math.round(b / n);
    small[i + 3] = Math.round(a / n);
  }
}
writeFileSync(join(OUT_DIR, 'icon-192.png'), encodePng(small, SMALL));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`[icon] ${OUT} （${kb(png.length)}，${SIZE}×${SIZE}）`);
console.log(`[icon] ${join(OUT_DIR, 'icon-192.png')} （192×192）`);
console.log(`[icon] PNG 魔数 ${png.subarray(1, 4).toString('ascii') === 'PNG' ? 'OK' : '异常'}，尺寸 ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
