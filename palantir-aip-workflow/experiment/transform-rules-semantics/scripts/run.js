// transform-rules-semantics/scripts/run.js — 只产数据，不下结论
// 验证 spec §3.6 十种规则 type 的确定性语义 + §3.1 链式执行 + §5 失败中止零副作用
// 运行: node scripts/run.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============ 参考实现（实验用最小 exec 核心，非正式交付） ============
// 单元格一律为字符串（CSV 语义）；cast 输出规范化字符串，失败置 null

function castValue(v, targetType) {
  if (v === null || v === '') return null;
  const s = String(v).trim();
  switch (targetType) {
    case 'string': return s;
    case 'integer': {
      if (!/^-?\d+$/.test(s)) return null;
      return String(parseInt(s, 10));
    }
    case 'number': {
      if (!/^-?\d*\.?\d+$/.test(s)) return null;
      return String(parseFloat(s));
    }
    case 'boolean': {
      if (/^(true|TRUE|1)$/.test(s)) return 'true';
      if (/^(false|FALSE|0)$/.test(s)) return 'false';
      return null;
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
      return s;
    }
    default: throw new Error(`未知 targetType: ${targetType}`);
  }
}

function cmp(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && /^-?\d/.test(a) && /^-?\d/.test(b)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function applyRule(row, rule) {
  const col = (c) => row[c];
  const set = (c, v) => { row[c] = v; };
  switch (rule.type) {
    case 'regex_replace': {
      const re = new RegExp(rule.pattern, 'g');
      set(rule.column, String(col(rule.column) ?? '').replace(re, rule.replacement));
      return;
    }
    case 'regex_extract': {
      const re = new RegExp(rule.pattern);
      const m = String(col(rule.column) ?? '').match(re);
      set(rule.column, m ? (m[1] !== undefined ? m[1] : m[0]) : null);
      return;
    }
    case 'map': {
      const v = col(rule.column);
      if (v in rule.mappings) set(rule.column, rule.mappings[v]);
      return; // 未命中保持原值
    }
    case 'filter': {
      // filter 由 exec 在行级外处理（保留/丢弃），此处实现条件判定
      const { column, op, value } = rule.condition;
      const v = col(column);
      switch (op) {
        case 'eq': return cmp(v, value) === 0;
        case 'neq': return cmp(v, value) !== 0;
        case 'gt': return cmp(v, value) > 0;
        case 'lt': return cmp(v, value) < 0;
        case 'contains': return String(v ?? '').includes(String(value));
        default: throw new Error(`未知 op: ${op}`);
      }
    }
    case 'concat': {
      const parts = rule.columns.map((c) => String(col(c) ?? ''));
      set(rule.targetColumn, parts.join(rule.separator));
      return;
    }
    case 'split': {
      const parts = String(col(rule.column) ?? '').split(rule.separator);
      rule.targetColumns.forEach((tc, i) => set(tc, i < parts.length ? parts[i] : ''));
      return;
    }
    case 'cast': {
      set(rule.column, castValue(col(rule.column), rule.targetType));
      return;
    }
    case 'lower': set(rule.column, String(col(rule.column) ?? '').toLowerCase()); return;
    case 'upper': set(rule.column, String(col(rule.column) ?? '').toUpperCase()); return;
    case 'trim': set(rule.column, String(col(rule.column) ?? '').trim()); return;
    default: throw new Error(`未知规则 type: ${rule.type}`);
  }
}

// 执行 transforms：返回 { cols, rows }（数组顺序 = 执行顺序，filter 缩减行集）
function execTransforms(cols, rows, transforms) {
  let curRows = rows.map((r) => Object.assign({}, r));
  for (const t of transforms) {
    if (t.type === 'filter') {
      curRows = curRows.filter((r) => applyRule(r, t));
    } else {
      for (const r of curRows) applyRule(r, t);
    }
    // 新列加入 schema
    if (t.targetColumn && !cols.includes(t.targetColumn)) cols = cols.concat([t.targetColumn]);
    if (t.type === 'split') {
      for (const tc of t.targetColumns) if (!cols.includes(tc)) cols = cols.concat([tc]);
    }
  }
  return { cols, rows: curRows };
}

// ============ H2a: 十种规则语义用例 ============
const ruleCases = [
  {
    id: 'regex_replace-global', type: 'regex_replace',
    rule: { type: 'regex_replace', pattern: '\\d+', replacement: '#', column: 'code' },
    rows: [{ code: 'a12b34' }], expect: [{ code: 'a#b#' }],
    desc: 'regex_replace 全局替换（g 标志）',
  },
  {
    id: 'regex_extract-group', type: 'regex_extract',
    rule: { type: 'regex_extract', pattern: '(\\d{4})-(\\d{2})', column: 'date' },
    rows: [{ date: '2026-08-05' }], expect: [{ date: '2026' }],
    desc: 'regex_extract 取首个匹配组',
  },
  {
    id: 'regex_extract-nogroup', type: 'regex_extract',
    rule: { type: 'regex_extract', pattern: '\\d+', column: 'code' },
    rows: [{ code: 'x42y' }], expect: [{ code: '42' }],
    desc: 'regex_extract 无组则全匹配',
  },
  {
    id: 'regex_extract-nomatch', type: 'regex_extract',
    rule: { type: 'regex_extract', pattern: '\\d+', column: 'code' },
    rows: [{ code: 'abc' }], expect: [{ code: null }],
    desc: 'regex_extract 无匹配置 null',
  },
  {
    id: 'map-hit', type: 'map',
    rule: { type: 'map', mappings: { 'US': '美国', 'CN': '中国' }, column: 'country' },
    rows: [{ country: 'CN' }], expect: [{ country: '中国' }],
    desc: 'map 命中映射',
  },
  {
    id: 'map-miss', type: 'map',
    rule: { type: 'map', mappings: { 'US': '美国' }, column: 'country' },
    rows: [{ country: 'JP' }], expect: [{ country: 'JP' }],
    desc: 'map 未命中保持原值',
  },
  {
    id: 'filter-eq', type: 'filter',
    rule: { type: 'filter', condition: { column: 'status', op: 'eq', value: 'active' } },
    rows: [{ status: 'active' }, { status: 'closed' }], expect: [{ status: 'active' }],
    desc: 'filter eq 保留匹配行',
  },
  {
    id: 'filter-gt-numeric', type: 'filter',
    rule: { type: 'filter', condition: { column: 'age', op: 'gt', value: '18' } },
    rows: [{ age: '17' }, { age: '19' }, { age: '9' }], expect: [{ age: '19' }],
    desc: 'filter gt 数值比较（"9" 应被排除，字符串序会错）',
  },
  {
    id: 'filter-contains', type: 'filter',
    rule: { type: 'filter', condition: { column: 'name', op: 'contains', value: 'li' } },
    rows: [{ name: 'alice' }, { name: 'bob' }], expect: [{ name: 'alice' }],
    desc: 'filter contains 子串',
  },
  {
    id: 'concat-basic', type: 'concat',
    rule: { type: 'concat', columns: ['first', 'last'], targetColumn: 'full', separator: ' ' },
    rows: [{ first: 'Alice', last: 'Lee' }], expect: [{ first: 'Alice', last: 'Lee', full: 'Alice Lee' }],
    desc: 'concat 拼接新列',
  },
  {
    id: 'split-basic', type: 'split',
    rule: { type: 'split', column: 'tags', separator: '|', targetColumns: ['t1', 't2', 't3'] },
    rows: [{ tags: 'a|b' }], expect: [{ tags: 'a|b', t1: 'a', t2: 'b', t3: '' }],
    desc: 'split 拆分多列，不足补空',
  },
  {
    id: 'cast-integer-ok', type: 'cast',
    rule: { type: 'cast', column: 'n', targetType: 'integer' },
    rows: [{ n: '007' }], expect: [{ n: '7' }],
    desc: 'cast integer 规范化',
  },
  {
    id: 'cast-integer-fail', type: 'cast',
    rule: { type: 'cast', column: 'n', targetType: 'integer' },
    rows: [{ n: '12.5' }], expect: [{ n: null }],
    desc: 'cast integer 失败置 null',
  },
  {
    id: 'cast-boolean', type: 'cast',
    rule: { type: 'cast', column: 'b', targetType: 'boolean' },
    rows: [{ b: 'TRUE' }, { b: 'yes' }], expect: [{ b: 'true' }, { b: null }],
    desc: 'cast boolean 规范化与失败',
  },
  {
    id: 'cast-date', type: 'cast',
    rule: { type: 'cast', column: 'd', targetType: 'date' },
    rows: [{ d: '2026-08-05' }, { d: '05/08/2026' }], expect: [{ d: '2026-08-05' }, { d: null }],
    desc: 'cast date 格式校验',
  },
  {
    id: 'lower-upper-trim', type: 'lower',
    rule: { type: 'lower', column: 's' },
    rows: [{ s: ' AbC ' }], expect: [{ s: ' abc ' }],
    desc: 'lower 只转小写不动空白（trim 是独立规则）',
  },
  {
    id: 'trim-basic', type: 'trim',
    rule: { type: 'trim', column: 's' },
    rows: [{ s: '  x  ' }], expect: [{ s: 'x' }],
    desc: 'trim 去首尾空白',
  },
];

// ============ H2b: 链式执行 ============
// rule1: regex_replace code 中数字 → #；rule2: lower 作用于 rule1 已改的 code
const chainCase = {
  id: 'chain-order',
  desc: '链式：规则 2 看到规则 1 的产物',
  transforms: [
    { type: 'regex_replace', pattern: '\\d+', replacement: '#', column: 'code' },
    { type: 'upper', column: 'code' },
  ],
  rows: [{ code: 'a12b' }],
  expect: [{ code: 'A#B' }],
};

// ============ H2c: 失败中止零副作用（最小 validate + exec 流程） ============
function runExecWithGuard(projectDir, transforms, dataRows) {
  // 模拟 exec 内部强制先跑 validate：column 存在 / regex 可编译 / approved 存在
  const problems = [];
  if (!fs.existsSync(path.join(projectDir, 'approved'))) {
    return { ok: false, problems: ['✘ [exec] approved/ 目录不存在'], outputs: [], state: readState(projectDir) };
  }
  const headers = Object.keys(dataRows[0] || {});
  for (const t of transforms) {
    const col = t.column || (t.condition && t.condition.column) || (t.columns && t.columns[0]);
    if (col && !headers.includes(col)) problems.push(`✘ [${t.id || t.type}] 引用的 column 不存在: ${col}`);
    if (t.type === 'regex_replace' || t.type === 'regex_extract') {
      try { new RegExp(t.pattern); } catch (e) { problems.push(`✘ [${t.id || t.type}] 正则非法: ${t.pattern}`); }
    }
  }
  if (problems.length > 0) return { ok: false, problems, outputs: [], state: readState(projectDir) };
  // 执行 + 统一写盘
  const { cols, rows } = execTransforms(headers, dataRows, transforms);
  const outFile = path.join(projectDir, 'output', 'transform.csv');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ cols, rows }));
  return { ok: true, problems: [], outputs: [outFile], state: readState(projectDir) };
}

function readState(dir) {
  const f = path.join(dir, 'state.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function setupProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-trs-'));
  fs.mkdirSync(path.join(dir, 'approved'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ currentStep: 'model', lastEventId: 3 }));
  return dir;
}

const destructiveCases = [
  {
    id: 'invalid-column',
    desc: 'column 不存在 → validate 拒绝、无输出、状态不推进',
    transforms: [{ id: 'r1', type: 'regex_replace', pattern: 'a', replacement: 'b', column: 'ghost' }],
    data: [{ name: 'alice' }],
  },
  {
    id: 'invalid-regex',
    desc: '正则非法 → 拒绝、无输出、状态不推进',
    transforms: [{ id: 'r2', type: 'regex_replace', pattern: '(', replacement: 'b', column: 'name' }],
    data: [{ name: 'alice' }],
  },
  {
    id: 'no-approved',
    desc: 'approved/ 不存在 → 中止',
    transforms: [{ id: 'r3', type: 'lower', column: 'name' }],
    data: [{ name: 'ALICE' }],
    skipSetup: true,
  },
];

function runDestructive(c) {
  const dir = setupProjectDir();
  if (c.skipSetup) fs.rmSync(path.join(dir, 'approved'), { recursive: true, force: true });
  const stateBefore = readState(dir);
  const res = runExecWithGuard(dir, c.transforms, c.data);
  const outputs = fs.existsSync(path.join(dir, 'output'))
    ? fs.readdirSync(path.join(dir, 'output')) : [];
  const stateAfter = readState(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    id: c.id, desc: c.desc,
    ok: res.ok, problems: res.problems,
    outputsAfter: outputs,
    stateBefore: stateBefore && stateBefore.currentStep,
    stateAfter: stateAfter && stateAfter.currentStep,
    stateUnchanged: JSON.stringify(stateBefore) === JSON.stringify(stateAfter),
  };
}

// ============ 汇总输出 ============
const results = { ruleCases: [], chain: null, destructive: [] };

for (const c of ruleCases) {
  const { rows } = execTransforms(Object.keys(c.rows[0]), c.rows, [c.rule]);
  results.ruleCases.push({
    id: c.id, desc: c.desc,
    expected: JSON.stringify(c.expect),
    actual: JSON.stringify(rows),
    pass: JSON.stringify(rows) === JSON.stringify(c.expect),
  });
}

{
  const { rows } = execTransforms(Object.keys(chainCase.rows[0]), chainCase.rows, chainCase.transforms);
  results.chain = {
    id: chainCase.id, desc: chainCase.desc,
    expected: JSON.stringify(chainCase.expect),
    actual: JSON.stringify(rows),
    pass: JSON.stringify(rows) === JSON.stringify(chainCase.expect),
  };
}

for (const c of destructiveCases) results.destructive.push(runDestructive(c));

console.log(JSON.stringify(results, null, 2));
