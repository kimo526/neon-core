// 极简 QR 编码器：把局域网地址变成二维码，手机扫一下就进游戏。
//
// 只支持版本 1–6（容量到 134 字节，装局域网 URL 绰绰有余）、字节模式、纠错等级 M。
// 这几个版本有个关键好处：**都是单块数据**，不需要处理块交织，代码能短一大截。
// 校验方式见 tests/qr.test.js：那里还写了一个解码器，把编码结果解回原文比对。
//
// 参考标准：ISO/IEC 18004。

// ---------- 伽罗华域 GF(256)，本原多项式 0x11d ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** 生成多项式 (x-α⁰)(x-α¹)...(x-α^(n-1)) */
function generatorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon 纠错码字 */
export function rsEncode(data, ecLen) {
  const gen = generatorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// ---------- 版本 / 容量表（纠错等级 M）----------
// [版本, 每块数据码字数, 纠错码字数, 总码字数]
const VERSIONS = [
  null,
  { v: 1, data: 16, ec: 10, total: 26 },
  { v: 2, data: 28, ec: 16, total: 44 },
  { v: 3, data: 44, ec: 26, total: 70 },
  { v: 4, data: 64, ec: 36, total: 100 },
  { v: 5, data: 86, ec: 48, total: 134 },
  { v: 6, data: 108, ec: 60, total: 168 },
];

// 各版本的校正图形中心坐标
const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

/** 版本 1–6 的格式信息比特（纠错等级 M + 掩码 0–7） */
const FORMAT_BITS_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

const sizeOf = (v) => v * 4 + 17;

/** 把数据按掩码规则翻转 */
function maskFn(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** 掩码惩罚分（标准里的 4 条规则，用于挑最好的掩码） */
function penalty(m) {
  const n = m.length;
  let score = 0;
  // 规则 1：同色连续 5 个以上
  for (let i = 0; i < n; i++) {
    let run = 1;
    for (let j = 1; j < n; j++) {
      if (m[i][j] === m[i][j - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
    run = 1;
    for (let j = 1; j < n; j++) {
      if (m[j][i] === m[j - 1][i]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  // 规则 2：2×2 同色块
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  // 规则 3：类似定位图形的 1011101 0000 模式
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (arr, pat) => pat.every((p, k) => arr[k] === p);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x <= n - 11; x++) {
      const row = m[y].slice(x, x + 11);
      if (matches(row, pat1) || matches(row, pat2)) score += 40;
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y <= n - 11; y++) {
      const col = [];
      for (let k = 0; k < 11; k++) col.push(m[y + k][x]);
      if (matches(col, pat1) || matches(col, pat2)) score += 40;
    }
  }
  // 规则 4：黑白比例偏离 50%
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) dark += m[y][x];
  const ratio = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * 编码成二维码矩阵。
 * @returns {{size:number, modules:boolean[][], version:number}} true = 黑块
 */
export function encodeQr(text, { minVersion = 1 } = {}) {
  const bytes = [...new TextEncoder().encode(text)];

  // 选版本：先留出 2 字节模式/长度头
  let info = null;
  for (let v = minVersion; v < VERSIONS.length; v++) {
    const cand = VERSIONS[v];
    if (bytes.length + 2 <= cand.data) {
      info = cand;
      break;
    }
  }
  if (!info) throw new Error(`内容太长（${bytes.length} 字节），这个精简版编码器最多支持 ${VERSIONS[6].data - 2} 字节`);

  // ---- 位流：模式 0100 + 长度(8bit) + 数据 + 终止符 + 补齐 ----
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const capacityBits = info.data * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // 终止符
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
    dataCw.push(byte);
  }
  // 填充码字：0xEC / 0x11 交替
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (dataCw.length < info.data) dataCw.push(padBytes[pi++ % 2]);

  const allCw = [...dataCw, ...rsEncode(dataCw, info.ec)];

  // ---- 建矩阵：先放功能图形，再放数据 ----
  const size = sizeOf(info.v);
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    mod[y][x] = dark;
    reserved[y][x] = true;
  };

  // 定位图形（三个角）
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const inner = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inner && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(ox + x, oy + y, dark);
      }
    }
  }

  // 定时图形
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  // 校正图形
  const centers = ALIGN[info.v] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      // 跳过与定位图形重叠的位置
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
          set(cx + x, cy + y, dark);
        }
      }
    }
  }

  // 固定黑点
  set(8, size - 8, true);

  // 预留格式信息区（内容稍后填）
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // ---- 数据按"之"字形填入 ----
  let bitIndex = 0;
  const totalBits = allCw.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return 0; // 剩余位补 0
    const byte = allCw[bitIndex >> 3];
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x = 5; // 跳过定时列
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const xx of [x, x - 1]) {
        if (reserved[y][xx]) continue;
        mod[y][xx] = nextBit() === 1;
      }
    }
    upward = !upward;
  }

  // ---- 选掩码：8 种里挑惩罚分最低的 ----
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const cand = mod.map((row) => row.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && maskFn(mask, x, y)) cand[y][x] = !cand[y][x];
      }
    }
    // 写格式信息
    const fmt = FORMAT_BITS_M[mask];
    for (let i = 0; i <= 5; i++) cand[8][i] = ((fmt >> i) & 1) === 1;
    cand[8][7] = ((fmt >> 6) & 1) === 1;
    cand[8][8] = ((fmt >> 7) & 1) === 1;
    cand[7][8] = ((fmt >> 8) & 1) === 1;
    for (let i = 9; i <= 14; i++) cand[14 - i][8] = ((fmt >> i) & 1) === 1;
    for (let i = 0; i <= 7; i++) cand[size - 1 - i][8] = ((fmt >> i) & 1) === 1;
    for (let i = 8; i <= 14; i++) cand[8][size - 15 + i] = ((fmt >> i) & 1) === 1;
    cand[size - 8][8] = true;

    const score = penalty(cand);
    if (!best || score < best.score) best = { score, matrix: cand, mask };
  }

  return { size, modules: best.matrix, version: info.v, mask: best.mask };
}

/** 输出成终端里能扫的 ASCII 二维码（每行两个模块用半块字符压缩高度） */
export function qrToText(qr, { quiet = 2 } = {}) {
  const { size, modules } = qr;
  const lines = [];
  const at = (x, y) => (x >= 0 && y >= 0 && x < size && y < size ? modules[y][x] : false);
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = '';
    for (let x = -quiet; x < size + quiet; x++) {
      const top = at(x, y);
      const bottom = at(x, y + 1);
      // 用半块字符：上下都黑=█，上黑=▀，下黑=▄，都白=空格
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
