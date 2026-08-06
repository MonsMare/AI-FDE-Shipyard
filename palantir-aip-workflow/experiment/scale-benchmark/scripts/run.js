// scale-benchmark/scripts/run.js — 纯 JS 行级执行基准（只产数据，不下结论）
// 运行: node scripts/run.js <N> [--csv path]
// 流程: 读 CSV → 行级 2 规则（regex_replace + trim + cast）→ 统一写盘 → 输出耗时/RSS/产物
'use strict';

const fs = require('fs');
const path = require('path');

const N = parseInt(process.argv[2] || '100000', 10);
const csvPath = process.argv.indexOf('--csv') >= 0
  ? process.argv[process.argv.indexOf('--csv') + 1]
  : path.join(__dirname, 'data', `bench-${N}.csv`);
const outPath = path.join(__dirname, 'data', `out-${N}.csv`);

const t0 = process.hrtime.bigint();
const elapsedMs = () => Number(process.hrtime.bigint() - t0) / 1e6;
const peakRssMB = () => process.resourceUsage().maxRSS / 1024;

// ==== 解析（RFC 4180 状态机，同 csv-parse-edge-cases 修复版） ====
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', inQ = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return { cols: rows[0], rows: rows.slice(1) };
}

// ==== 行级规则（与 transform-rules-semantics 参考实现同语义） ====
function execTransforms(cols, rows) {
  const idx = (c) => cols.indexOf(c);
  const re = /REF-(\d+)/g;
  let i = idx('note'), j = idx('city'), k = idx('status'), m = idx('amount');
  for (const r of rows) {
    // regex_replace: note 中 REF-xxxxx 数字部分 → [REDACTED]
    r[i] = r[i].replace(re, 'REF-[REDACTED]');
    // trim: city/status
    r[j] = r[j].trim();
    r[k] = r[k].trim();
    // cast: amount → number 规范化（失败置 null）
    const a = r[m];
    r[m] = /^-?\d*\.?\d+$/.test(a) ? String(parseFloat(a)) : null;
  }
  return rows;
}

// ==== 序列化 ====
function stringify(cols, rows) {
  const esc = (v) => {
    const s = v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

// 阶段计时
const tParse0 = process.hrtime.bigint();
const raw = fs.readFileSync(csvPath, 'utf8');
const tReadMs = elapsedMs();
const { cols, rows } = parseCsv(raw);
const tParseMs = elapsedMs();

const tExec0 = process.hrtime.bigint();
execTransforms(cols, rows);
const tExecMs = elapsedMs();

const out = stringify(cols, rows);
const tStringifyMs = elapsedMs();
fs.writeFileSync(outPath, out);
const tWriteMs = elapsedMs();

console.log(JSON.stringify({
  rows: rows.length,
  cols: cols.length,
  inputBytes: raw.length,
  outputBytes: out.length,
  elapsedMs: { read: +tReadMs.toFixed(1), parse: +(tParseMs - tReadMs).toFixed(1), exec: +(tExecMs - tParseMs).toFixed(1), stringify: +(tStringifyMs - tExecMs).toFixed(1), write: +(tWriteMs - tStringifyMs).toFixed(1), total: +tWriteMs.toFixed(1) },
  peakRssMB: +peakRssMB().toFixed(1),
  outFile: outPath,
}, null, 2));
