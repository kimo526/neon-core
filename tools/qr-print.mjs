// 给一个地址打印终端二维码（手动用）
import { encodeQr, qrToText } from '../src/qr.js';

const url = process.argv[2] ?? 'http://192.168.1.3:8787/';
const qr = encodeQr(url);
console.log(`\n  ${url}\n`);
console.log(
  qrToText(qr, { quiet: 2 })
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n')
);
console.log('');
