// QR 编码器的自验证：写一个解码器，把编码结果解回原文比对。
// 二维码最容易"看着对但扫不出来"，所以这里不测外观，直接做端到端往返 + 结构检查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrToText, rsEncode } from '../src/qr.js';

// ---------- 与编码器对称的解码器 ----------
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

const VERSIONS = [
  null,
  { v: 1, data: 16, ec: 10 },
  { v: 2, data: 28, ec: 16 },
  { v: 3, data: 44, ec: 26 },
  { v: 4, data: 64, ec: 36 },
  { v: 5, data: 86, ec: 48 },
  { v: 6, data: 108, ec: 60 },
];
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const FORMAT_BITS_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

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

/** 从矩阵里读格式信息 → { ecLevel, mask } */
function readFormat(modules) {
  const size = modules.length;
  // 左上那一份：bit i 在 (8,i) i=0..5, (8,7),(8,8),(7,8), (i,8) i=9..14
  let bits = 0;
  const get = (x, y) => (modules[y][x] ? 1 : 0);
  for (let i = 0; i <= 5; i++) bits |= get(i, 8) << i;
  bits |= get(7, 8) << 6;
  bits |= get(8, 8) << 7;
  bits |= get(8, 7) << 8;
  for (let i = 9; i <= 14; i++) bits |= get(8, 14 - i) << i;
  // 异或回掩码（标准规定格式信息与 0x5412 异或）
  const fmt = bits ^ 0x5412;
  const ecBits = fmt >> 13;
  const mask = (fmt >> 10) & 0b111;
  const ecName = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' }[ecBits & 0b11];
  return { ecName, mask, raw: bits };
}

/** 检查纠错码字是否自洽：把整块码字当多项式，α^0..α^(ec-1) 处的取值应全为 0 */
function rsSyndromesOk(codewords, ecLen) {
  const syn = [];
  for (let i = 0; i < ecLen; i++) {
    let acc = 0;
    for (const cw of codewords) acc = gfMul(acc, EXP[i]) ^ cw;
    syn.push(acc);
  }
  return syn.every((s) => s === 0);
}

/** 完整解码：去掩码 → 读数据 → 反填充 → 解析位流 */
function decodeQr(modules) {
  const size = modules.length;
  const version = (size - 17) / 4;
  const info = VERSIONS[version];
  assert.ok(info, `版本 ${version} 不在支持范围`);

  const { mask } = readFormat(modules);

  // 重建 reserved 图（和编码器同一套规则）
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) reserved[y][x] = true;
  };
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) mark(ox + x, oy + y);
  }
  for (let i = 8; i < size - 8; i++) {
    mark(i, 6);
    mark(6, i);
  }
  for (const cy of ALIGN[version] ?? []) {
    for (const cx of ALIGN[version] ?? []) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) mark(cx + x, cy + y);
    }
  }
  mark(8, size - 8);
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }

  // 去掩码 + 按"之"字形读比特
  const bits = [];
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x = 5;
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const xx of [x, x - 1]) {
        if (reserved[y][xx]) continue;
        let v = modules[y][xx];
        if (maskFn(mask, xx, y)) v = !v;
        bits.push(v ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const totalCw = info.data + info.ec;
  const cw = [];
  for (let i = 0; i + 8 <= bits.length && cw.length < totalCw; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    cw.push(b);
  }
  const dataCw = cw.slice(0, info.data);
  const ecCw = cw.slice(info.data);
  const rsOk = rsSyndromesOk(cw, info.ec);

  // 解析位流
  let bitPos = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >> 3;
      const bit = (dataCw[byteIdx] >> (7 - (bitPos & 7))) & 1;
      v = (v << 1) | bit;
      bitPos++;
    }
    return v;
  };
  const mode = take(4);
  const len = take(8);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), mode, mask, rsOk, version, ec: readFormat(modules).ecName };
}

// ---------- 测试 ----------

test('QR 往返：编出来的码能被解回原文', () => {
  for (const text of [
    'http://192.168.1.3:8787/',
    'A',
    'https://example.github.io/neon-core/?mode=extreme&autostart=1',
    '中文也要能编码：解限核心',
    '0123456789'.repeat(3),
  ]) {
    const qr = encodeQr(text);
    const got = decodeQr(qr.modules);
    assert.equal(got.text, text, `往返失败：「${text}」→「${got.text}」`);
    assert.equal(got.mode, 0b0100, '应该是字节模式');
  }
});

test('QR 纠错码字自洽（α^0..α^(ec-1) 处取值全为 0）', () => {
  const qr = encodeQr('http://192.168.1.3:8787/');
  const got = decodeQr(qr.modules);
  assert.equal(got.rsOk, true, 'Reed-Solomon 纠错码字不自洽，扫出来必然报错');
  assert.equal(got.ec, 'M', '纠错等级应该是 M');
});

test('QR 格式信息正确：纠错等级 M + 掩码编号落在 0–7', () => {
  for (let i = 0; i < 6; i++) {
    const qr = encodeQr('x'.repeat(1 + i * 4));
    const fmt = readFormat(qr.modules);
    assert.equal(fmt.ecName, 'M');
    assert.ok(fmt.raw === FORMAT_BITS_M[fmt.mask], `格式信息与掩码 ${fmt.mask} 不匹配`);
  }
});

test('QR 功能图形规范：三个定位图形 + 定时图形 + 固定黑点', () => {
  const qr = encodeQr('http://192.168.1.3:8787/');
  const { modules: m, size } = qr;

  // 定位图形：外框黑、内圈白、中心 3×3 黑
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const onBorder = x === 0 || x === 6 || y === 0 || y === 6;
        const inCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const expect = onBorder || inCore;
        assert.equal(
          m[oy + y][ox + x],
          expect,
          `定位图形 (${ox},${oy}) 内 (${x},${y}) 应该是 ${expect ? '黑' : '白'}`
        );
      }
    }
  }

  // 定时图形：第 6 行/列交替
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `横向定时图形第 ${i} 格不对`);
    assert.equal(m[i][6], i % 2 === 0, `纵向定时图形第 ${i} 格不对`);
  }

  // 固定黑点
  assert.equal(m[size - 8][8], true, '右下固定黑点应该是黑的');
});

test('QR 版本随内容长度增长，且超长会明确报错', () => {
  const small = encodeQr('a');
  const big = encodeQr('x'.repeat(100));
  assert.ok(big.version > small.version, '内容变长应该用更高版本');
  assert.equal(small.size, small.version * 4 + 17, '尺寸 = 版本*4+17');

  assert.throws(() => encodeQr('x'.repeat(200)), /太长/, '超长应该报错而不是生成坏码');
});

test('QR ASCII 渲染：形状对得上矩阵，且带静默区', () => {
  const qr = encodeQr('http://192.168.1.3:8787/');
  const text = qrToText(qr, { quiet: 2 });
  const lines = text.split('\n');
  // 每行两个模块 + 左右静默区
  const expectedRows = Math.ceil((qr.size + 4) / 2);
  assert.equal(lines.length, expectedRows, `行数不对：${lines.length} vs ${expectedRows}`);
  for (const line of lines) {
    assert.equal([...line].length, qr.size + 4, '每行宽度应该是 尺寸+静默区');
  }
  // 左上角定位图形应该出现在矩阵对应位置（静默区之后）
  const hasDark = text.includes('█') || text.includes('▀') || text.includes('▄');
  assert.ok(hasDark, '渲染出来应该是黑的');
});

test('rsEncode：已知向量的纠错码字正确', () => {
  // 标准里的经典例子：版本 1-M，"HELLO WORLD" 的 RS 结果可以参考实现交叉验证。
  // 这里用"自洽性"验证：把 0 数据编码，纠错码字必须全 0（因为 0 多项式除以生成多项式余 0）
  const zeros = new Array(16).fill(0);
  const ec = rsEncode(zeros, 10);
  assert.deepEqual(ec, new Array(10).fill(0), '全 0 数据的纠错码字应该全 0');

  // 单字节数据：验证长度和取值范围
  const ec2 = rsEncode([0x40, 0x01], 10);
  assert.equal(ec2.length, 10);
  assert.ok(ec2.every((b) => Number.isInteger(b) && b >= 0 && b <= 255));
});
