#!/usr/bin/env node
// schema-infer.js — 确定性 schema 推断器
// 输入：CSV / JSON / JSONL 文件
// 输出：schema JSON（列名、推断类型、样本值、空值率、去重计数）
// 用途：paip-source skill 调用，产物喂给 LLM 做语义建模（paip-infer）
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const path = require('path');

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

function parseCsv(text) {
  // 极简 CSV 解析：处理引号包裹与逗号分隔，不支持内嵌换行
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) fail('CSV 需要至少一行表头 + 一行数据');
  const header = lines[0];
  const cols = [];
  let cur = '';
  let inQ = false;
  for (const ch of header) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = [];
    cur = ''; inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return { cols, rows };
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
  for (const row of rows) {
    for (let i = 0; i < cols.length; i++) {
      const val = row[i] === undefined ? null : row[i];
      const t = typeOf(val);
      const st = colStats[i];
      if (t === 'null') { st.nullCount++; continue; }
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
