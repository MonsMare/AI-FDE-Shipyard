#!/usr/bin/env node
// csv.js — 公共 CSV 库（RFC 4180 解析与序列化）
// 修复实验 csv-parse-edge-cases 确证的缺陷：BOM 剥离、转义引号、引号内嵌换行、空行保留
// 零依赖，Node 18+。
// 接口: parseCsv(text) / stringify(cols, rows) / readCsvFile(path) / writeCsvFile(path, cols, rows)
'use strict';

const fs = require('fs');

// RFC 4180 状态机解析：单趟扫描
// - 文件头 BOM（\ufeff）剥离
// - " 进入引用态，"" 为转义引号
// - 引号内可含逗号/换行/CRLF
// - 空行保留（产出 [''] 单格行）
// - \r\n 与 \n 行尾均可；\r 单独出现时吞掉
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 剥离
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // 转义引号
        inQ = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; } // 吞掉 \r（\r\n 行尾）
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); } // 末行无换行
  if (rows.length === 0) return { cols: [], rows: [] };
  return { cols: rows[0], rows: rows.slice(1) };
}

// RFC 4180 序列化：含逗号/引号/换行/CR 的值用引号包裹、"" 转义；行序稳定
function stringify(cols, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

function readCsvFile(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function writeCsvFile(filePath, cols, rows) {
  fs.writeFileSync(filePath, stringify(cols, rows));
}

module.exports = { parseCsv, stringify, readCsvFile, writeCsvFile };
