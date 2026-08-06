// csv-parse-edge-cases/scripts/run.js — 只产数据，不下结论
// 对照：现有 parseCsv（schema-infer.js 原样抽取）vs 修复版状态机解析 + stringify
// 运行: node scripts/run.js
'use strict';

// === 现有实现（来自 bin/schema-infer.js 34-61 行，原样保留） ===
function parseCsvExisting(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { error: 'CSV 需要至少一行表头 + 一行数据' };
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

// === 修复版：RFC 4180 状态机解析（BOM 剥离 / 转义引号 / 内嵌换行 / 空行保留） ===
function parseCsvFixed(text) {
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

// === stringify（RFC 4180 写入器） ===
function stringify(cols, rows) {
  const esc = (v) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\r\n');
}

// === 用例集 ===
const cases = [
  {
    id: 'bom',
    desc: 'BOM 前缀不应污染首个表头',
    input: '\ufeffid,name\r\n1,alice\r\n2,bob\r\n',
    expect: { cols: ['id', 'name'], rows: [['1', 'alice'], ['2', 'bob']] },
  },
  {
    id: 'escaped-quote',
    desc: '转义引号 "a""b" 应解析为 a"b',
    input: 'id,note\r\n1,"say ""hi"""\r\n',
    expect: { cols: ['id', 'note'], rows: [['1', 'say "hi"']] },
  },
  {
    id: 'embedded-newline',
    desc: '引号内嵌换行应保留为同一单元格',
    input: 'id,text\r\n1,"line1\nline2"\r\n',
    expect: { cols: ['id', 'text'], rows: [['1', 'line1\nline2']] },
  },
  {
    id: 'empty-line',
    desc: '数据区空行应保留（行数不变）',
    input: 'id,name\r\n1,alice\r\n\r\n2,bob\r\n',
    expect: { cols: ['id', 'name'], rows: [['1', 'alice'], [''], ['2', 'bob']] },
  },
  {
    id: 'quoted-commas',
    desc: '常规引用字段（含逗号/引号）',
    input: 'a,b\r\n"x,y","z""q"\r\n',
    expect: { cols: ['a', 'b'], rows: [['x,y', 'z"q']] },
  },
  {
    id: 'crlf',
    desc: 'CRLF 行尾正常',
    input: 'a,b\r\n1,2\r\n3,4\r\n',
    expect: { cols: ['a', 'b'], rows: [['1', '2'], ['3', '4']] },
  },
];

function fmt(v) {
  return JSON.stringify(v);
}

const results = { existing: [], fixed: [], roundtrip: [] };
for (const c of cases) {
  const ex = parseCsvExisting(c.input);
  const fx = parseCsvFixed(c.input);
  results.existing.push({
    id: c.id, desc: c.desc,
    expected: fmt(c.expect),
    actual: fmt(ex),
    pass: fmt(ex) === fmt(c.expect),
  });
  results.fixed.push({
    id: c.id, desc: c.desc,
    expected: fmt(c.expect),
    actual: fmt(fx),
    pass: fmt(fx) === fmt(c.expect),
  });
}

// 往返：parse → stringify → parse，值不变
const rtInputs = [
  'id,name\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,"multi\nline"\r\n',
  'a,b\r\n"x,y","z""q"\r\n',
];
for (const inp of rtInputs) {
  const p1 = parseCsvFixed(inp);
  const out = stringify(p1.cols, p1.rows);
  const p2 = parseCsvFixed(out);
  results.roundtrip.push({
    input: fmt(p1), output: fmt(out), reparsed: fmt(p2),
    pass: fmt(p1) === fmt(p2),
  });
}

console.log(JSON.stringify(results, null, 2));
