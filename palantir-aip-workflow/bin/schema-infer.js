#!/usr/bin/env node
// schema-infer.js — 确定性 schema 推断器
// 输入：CSV / JSON / JSONL 文件
// 输出：schema JSON（列名、推断类型、样本值、空值率、去重计数）
// 用途：paip-source skill 调用，产物喂给 LLM 做语义建模（paip-infer）
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const path = require('path');

const { parseCsv } = require('./csv.js');

const USAGE = `用法: node schema-infer.js <file> [--sample N]
支持格式: .csv / .json / .jsonl
--sample N  每个字段最多采样 N 个样本值（默认 5，0 表示全部）`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function typeOf(value) {
  if (value === null || value === undefined || value === '') return 'null';
  const s = String(value).trim();
  if (s === '') return 'null';
  if (/^-?\d+$/.test(s)) return 'integer';
  if (/^-?\d*\.\d+$/.test(s)) return 'number';
  if (/^(true|false)$/i.test(s)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return 'email';
  if (/^-?\d{1,3}(\.\d{1,3}){3}$/.test(s)) return 'ipv4';
  return 'string';
}

// P5: 脏格式变体识别（叠加在 typeOf 之上，不改变类型判定；仅 mixed 列输出）
// 初版识别：日期变体 MM/DD/YYYY、DD-MM-YYYY；金额变体 $ 前缀、空格千分位（含 , 或 . 小数）
const DIRTY_FORMATS = [
  { key: 'MM/DD/YYYY', re: /^\d{1,2}\/\d{1,2}\/\d{4}$/ },
  { key: 'DD-MM-YYYY', re: /^\d{1,2}-\d{1,2}-\d{4}$/ },
  { key: '$ 前缀', re: /^\$[\d,]+(?:\.\d+)?$/ },
  { key: '空格千分位', re: /^-?\d{1,3}( \d{3})+(?:[.,]\d+)?$/ },
];
// typeBreakdown 输出键序（只含出现过的类型）
const TYPE_BREAKDOWN_ORDER = ['string', 'date', 'integer', 'number', 'boolean', 'email', 'ipv4'];

function detectDirtyFormat(value) {
  const s = String(value).trim();
  for (const f of DIRTY_FORMATS) {
    if (f.re.test(s)) return f.key;
  }
  return null;
}

function inferFromRows(cols, rows, sampleN) {
  const colStats = cols.map((name) => ({
    name,
    inferredType: null,
    nullCount: 0,
    total: rows.length,
    sample: [],
    distinct: null,
  }));
  // P5: 每列类型计数与脏格式变体计数（仅 mixed 列用于输出）
  const typeCounts = cols.map(() => ({}));
  const dirtyCounts = cols.map(() => ({}));
  for (const row of rows) {
    for (let i = 0; i < cols.length; i++) {
      const val = row[i] === undefined ? null : row[i];
      const t = typeOf(val);
      const st = colStats[i];
      if (t === 'null') { st.nullCount++; continue; }
      typeCounts[i][t] = (typeCounts[i][t] || 0) + 1;
      const dirty = detectDirtyFormat(val);
      if (dirty) dirtyCounts[i][dirty] = (dirtyCounts[i][dirty] || 0) + 1;
      if (!st.inferredType) st.inferredType = t;
      else if (st.inferredType !== t) {
        // 类型冲突：整数+小数→number；否则记 mixed
        if (st.inferredType === 'integer' && t === 'number') st.inferredType = 'number';
        else if (st.inferredType === 'number' && t === 'integer') { /* keep number */ }
        else st.inferredType = 'mixed';
      }
      if (sampleN === 0 || st.sample.length < sampleN) {
        if (!st.sample.includes(val)) st.sample.push(val);
      }
    }
  }
  // P5: mixed 列输出 typeBreakdown 与 dirtyFormats（非 mixed 列不加字段，保持 schema 结构稳定）
  for (let i = 0; i < colStats.length; i++) {
    const st = colStats[i];
    if (st.inferredType !== 'mixed') continue;
    const breakdown = {};
    for (const k of TYPE_BREAKDOWN_ORDER) {
      if (typeCounts[i][k]) breakdown[k] = typeCounts[i][k];
    }
    st.typeBreakdown = breakdown;
    const nonNull = st.total - st.nullCount;
    // 阈值：变体出现次数 ≥ 非空值的 30%（四舍五入，至少 1 次）
    const threshold = Math.max(1, Math.round(nonNull * 0.3));
    const formats = [];
    for (const f of DIRTY_FORMATS) {
      if ((dirtyCounts[i][f.key] || 0) >= threshold) formats.push(f.key);
    }
    if (formats.length > 0) st.dirtyFormats = formats;
  }
  // 去重计数（近似：取样本内的去重值 + 全部值集合计数仅在数据小时做精确统计）
  for (const st of colStats) {
    const nonNull = rows.filter((r) => typeOf(r[cols.indexOf(st.name)]) !== 'null');
    if (nonNull.length <= 5000) {
      st.distinct = new Set(nonNull.map((r) => r[cols.indexOf(st.name)])).size;
    } else {
      st.distinct = null; // 大数据量下略过精确去重
    }
  }
  return colStats;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  let sampleN = 5;
  const sIdx = args.indexOf('--sample');
  if (sIdx >= 0 && args[sIdx + 1]) sampleN = parseInt(args[sIdx + 1], 10);
  if (!file) fail(USAGE);
  if (!fs.existsSync(file)) fail(`文件不存在: ${file}`);

  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, 'utf8');
  let cols, rows;

  if (ext === '.csv') {
    ({ cols, rows } = parseCsv(raw));
    if (rows.length === 0) fail('CSV 需要至少一行表头 + 一行数据');
  } else if (ext === '.json') {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) fail('JSON 需为非空数组');
    cols = Object.keys(arr[0]);
    rows = arr.map((o) => cols.map((c) => (o[c] === undefined ? null : o[c])));
  } else if (ext === '.jsonl') {
    rows = raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (rows.length === 0) fail('JSONL 为空');
    cols = Object.keys(rows[0]);
    rows = rows.map((o) => cols.map((c) => (o[c] === undefined ? null : o[c])));
  } else {
    fail(`不支持的文件类型: ${ext}（支持 .csv / .json / .jsonl）`);
  }

  const colStats = inferFromRows(cols, rows, sampleN);
  const result = {
    file: path.basename(file),
    rows: rows.length,
    columns: colStats,
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
