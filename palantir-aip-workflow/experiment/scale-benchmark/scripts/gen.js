// scale-benchmark/scripts/gen.js — 生成可复现的 N 行 CSV（固定种子）
// 运行: node scripts/gen.js <N> [--out scripts/data/bench-N.csv]
'use strict';

const fs = require('fs');
const path = require('path');

// 固定种子 PRNG（mulberry32），保证可复现
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = parseInt(process.argv[2] || '100000', 10);
const rnd = mulberry32(42);

const first = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi'];
const cities = ['BJ', 'SH', 'GZ', 'SZ', 'CD', '  HZ  '];
const statuses = ['active', 'closed', 'pending', ' ACTIVE '];

const lines = ['id,name,city,age,status,amount,note'];
for (let i = 0; i < N; i++) {
  const id = i + 1;
  const name = first[Math.floor(rnd() * first.length)] + '-' + Math.floor(rnd() * 10000);
  const city = cities[Math.floor(rnd() * cities.length)];
  const age = String(10 + Math.floor(rnd() * 80));
  const status = statuses[Math.floor(rnd() * statuses.length)];
  const amount = (rnd() * 9999).toFixed(2);
  // note 含脏数据: 偶发数字串/空白/引号，供 regex_replace 与 trim 处理
  let note = rnd() < 0.3 ? 'REF-' + Math.floor(rnd() * 999999) : 'plain text';
  if (rnd() < 0.1) note = note.replace(/REF-(\d+)/, 'REF-$1 ');
  lines.push([id, name, city, age, status, amount, note].join(','));
}

const out = process.argv.indexOf('--out') >= 0
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(__dirname, 'data', `bench-${N}.csv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\r\n') + '\r\n');
console.log(JSON.stringify({ rows: N, file: out, bytes: fs.statSync(out).size }));
