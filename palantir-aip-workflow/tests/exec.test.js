// tests/exec.test.js — L1 规则语义 + merge + L3 破坏性（spec §6）
// 运行: node --test tests/exec.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { execProject } = require('../bin/exec.js');

// ---- fixture 构造 ----
// data: customers.csv (customerId,name,email,age) / orders.csv (orderId,customerId,name,amount)
const CUSTOMERS_CSV = 'customerId,name,email,age\r\nc1,Alice,a@x.com,17\r\nc2,Bob,b@x.com,19\r\nc3,  Carol  ,c@x.com,9\r\n';
const ORDERS_CSV = 'orderId,customerId,name,amount\r\no1,c1,ALICE,10.5\r\no2,X1,ALICE-v2,20.0\r\no3,c9,ghost,5.0\r\n';

function makeProject({ transforms, merges, data = { 'customers.csv': CUSTOMERS_CSV, 'orders.csv': ORDERS_CSV }, corrupt = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-exec-'));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [name, content] of Object.entries(data)) {
    if (content !== null) write(path.join('data', name), content);
  }
  write('sources/customers.csv.json', { id: 'customers.csv', path: path.join(dataDir, 'customers.csv'), format: 'csv' });
  write('sources/orders.csv.json', { id: 'orders.csv', path: path.join(dataDir, 'orders.csv'), format: 'csv' });
  write('schemas/customers.csv.schema.json', {
    file: 'customers.csv',
    columns: [{ name: 'customerId' }, { name: 'name' }, { name: 'email' }, { name: 'age' }],
  });
  write('schemas/orders.csv.schema.json', {
    file: 'orders.csv',
    columns: [{ name: 'orderId' }, { name: 'customerId' }, { name: 'name' }, { name: 'amount' }],
  });
  write('approved/objects.json', { objects: [] });
  write('approved/links.json', { links: [] });
  write('approved/transforms.json', { transforms: transforms || [] });
  write('approved/merges.json', { merges: merges || [] });
  write('state.json', { currentStep: 'review', steps: { review: 'in_progress' }, lastEventId: 5 });
  if (corrupt.removeApproved) fs.rmSync(path.join(dir, 'approved'), { recursive: true, force: true });
  if (corrupt.removeTransforms) fs.rmSync(path.join(dir, 'approved', 'transforms.json'));
  if (corrupt.removeMerges) fs.rmSync(path.join(dir, 'approved', 'merges.json'));
  return dir;
}

function outputs(dir) {
  const out = path.join(dir, 'output');
  return fs.existsSync(out) ? fs.readdirSync(out).sort() : [];
}

function auditEvents(dir) {
  const f = path.join(dir, 'audit', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function stateStep(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).currentStep;
}

// ==================== L1: 九种规则语义 ====================

test('L1: regex_replace 全局替换', () => {
  const dir = makeProject({
    transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'regex_replace', rule: { pattern: '\\d+', replacement: '#', column: 'customerId' } }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 't1.csv'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['c#', 'c#', 'c#']);
});

test('L1: regex_extract 首组提取与无匹配 null', () => {
  const dir = makeProject({
    transforms: [
      { id: 't1', source: 'customers.csv', target: 'x', type: 'regex_extract', rule: { pattern: '(c\\d)', column: 'customerId' } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 't1.csv'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['c1', 'c2', 'c3']);
});

test('L1: map 命中与未命中保持原值', () => {
  const dir = makeProject({
    transforms: [{
      id: 't1', source: 'customers.csv', target: 'x', type: 'map',
      rule: { mappings: { c1: 'C-ONE' }, column: 'customerId' },
    }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 't1.csv'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['C-ONE', 'c2', 'c3']);
});

test('L1: filter 数值比较（gt）与 contains', () => {
  const dir = makeProject({
    transforms: [
      { id: 'f1', source: 'customers.csv', target: 'x', type: 'filter', rule: { condition: { column: 'age', op: 'gt', value: '18' } } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'f1.csv'));
  // 仅 Bob(19) 保留；Carol(9) 若字符串比较会错误保留
  assert.deepStrictEqual(rows.map((x) => x[1]), ['Bob']);
});

test('L1: concat 拼接新列', () => {
  const dir = makeProject({
    transforms: [{
      id: 'c1', source: 'customers.csv', target: 'x', type: 'concat',
      rule: { columns: ['name', 'email'], targetColumn: 'full', separator: ' <' },
    }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { cols, rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'c1.csv'));
  assert.ok(cols.includes('full'));
  assert.deepStrictEqual(rows[0][cols.indexOf('full')], 'Alice <a@x.com');
});

test('L1: split 拆分多列不足补空', () => {
  const dir = makeProject({
    transforms: [{
      id: 's1', source: 'customers.csv', target: 'x', type: 'split',
      rule: { column: 'email', separator: '@', targetColumns: ['user', 'domain', 'extra'] },
    }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { cols, rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 's1.csv'));
  assert.deepStrictEqual(rows[0][cols.indexOf('user')], 'a');
  assert.deepStrictEqual(rows[0][cols.indexOf('domain')], 'x.com');
  assert.deepStrictEqual(rows[0][cols.indexOf('extra')], '');
});

test('L1: cast 规范化与失败置空', () => {
  const dir = makeProject({
    transforms: [
      { id: 'k1', source: 'customers.csv', target: 'x', type: 'cast', rule: { column: 'age', targetType: 'integer' } },
      { id: 'k2', source: 'customers.csv', target: 'x', type: 'cast', rule: { column: 'age', targetType: 'boolean' } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'k1.csv'));
  assert.deepStrictEqual(rows.map((x) => x[3]), ['17', '19', '9']);
  const { rows: rows2 } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'k2.csv'));
  assert.deepStrictEqual(rows2.map((x) => x[3]), ['', '', '']); // 全部失败置空
});

test('L1: lower/upper/trim', () => {
  const dir = makeProject({
    transforms: [
      { id: 'l1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } },
      { id: 'u1', source: 'customers.csv', target: 'x', type: 'upper', rule: { column: 'name' } },
      { id: 'r1', source: 'customers.csv', target: 'x', type: 'trim', rule: { column: 'name' } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  // 链式叠加：lower → upper → trim，故 '  Carol  ' → '  carol  ' → '  CAROL  ' → 'CAROL'
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'r1.csv'));
  assert.deepStrictEqual(rows[2][1], 'CAROL');
  // l1.csv 是 lower 产物（trim 未作用）
  const { rows: rowsL } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'l1.csv'));
  assert.deepStrictEqual(rowsL[2][1], '  carol  ');
});

test('L1: 链式执行（规则 2 看到规则 1 产物）', () => {
  const dir = makeProject({
    transforms: [
      { id: 'c1', source: 'customers.csv', target: 'x', type: 'regex_replace', rule: { pattern: '\\d+', replacement: '#', column: 'customerId' } },
      { id: 'c2', source: 'customers.csv', target: 'x', type: 'upper', rule: { column: 'customerId' } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'c2.csv'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['C#', 'C#', 'C#']);
});

// ==================== L1: merge 语义（value 声明驱动） ====================

test('L1: merge 键映射替换 + mapping 表', () => {
  const dir = makeProject({
    merges: [{
      id: 'm1',
      left: { source: 'customers.csv', key: 'customerId', value: 'c1' },
      right: { source: 'orders.csv', key: 'customerId', value: 'X1' },
      confidence: 0.93,
    }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const { cols, rows } = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'm1.csv'));
  // 左表 3 行 + 右表匹配 1 行（X1→c1 主键替换）
  assert.strictEqual(rows.length, 4);
  // 右表行并入：orderId=o2, customerId=c1（主键替换）, name 冲突→name_right, amount 独有→直接补
  const mergedRow = rows.find((x) => x[cols.indexOf('orderId')] === 'o2');
  assert.strictEqual(mergedRow[cols.indexOf('customerId')], 'c1');
  assert.strictEqual(mergedRow[cols.indexOf('name')], 'Alice'); // 左表优先
  assert.strictEqual(mergedRow[cols.indexOf('name_right')], 'ALICE-v2');
  assert.strictEqual(mergedRow[cols.indexOf('amount')], '20.0');
  // mapping 表
  const map = require('../bin/csv.js').readCsvFile(path.join(dir, 'output', 'm1-mapping.csv'));
  assert.deepStrictEqual(map.cols, ['right', 'left']);
  assert.deepStrictEqual(map.rows, [['X1', 'c1']]);
});

test('L1: merge fan-out（值不唯一）→ 中止零产物', () => {
  const dir = makeProject({
    merges: [{
      id: 'm2',
      left: { source: 'customers.csv', key: 'customerId', value: 'c1' },
      right: { source: 'orders.csv', key: 'customerId', value: 'c1' }, // orders 里 c1 出现 2 次? 不，1 次。用 right 重复：orders 里 o1 和 o3 的 customerId 不同
      confidence: 0.9,
    }],
    corrupt: {},
    data: {
      'customers.csv': 'customerId,name\r\nc1,A\r\nc1,B\r\n', // left.value c1 不唯一 → fan-out
      'orders.csv': 'orderId,customerId\r\no1,c1\r\n',
    },
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(outputs(dir), []);
  assert.strictEqual(stateStep(dir), 'review'); // 状态不推进
});

// ==================== L3: 破坏性 ====================

test('L3: column 不存在 → validate 拒绝、无输出、状态不推进、审计记 exec_failed', () => {
  const dir = makeProject({
    transforms: [{ id: 'bad1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'ghost' } }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(outputs(dir), []);
  assert.strictEqual(stateStep(dir), 'review');
  const evts = auditEvents(dir);
  assert.strictEqual(evts.length, 1);
  assert.strictEqual(evts[0].action, 'exec_failed');
  assert.ok(evts[0].detail.includes('bad1'));
});

test('L3: 正则非法 → 拒绝、无输出', () => {
  const dir = makeProject({
    transforms: [{ id: 'bad2', source: 'customers.csv', target: 'x', type: 'regex_replace', rule: { pattern: '(', replacement: 'b', column: 'name' } }],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(outputs(dir), []);
});

test('L3: approved/ 不存在 → 中止', () => {
  const dir = makeProject({ transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } }], corrupt: { removeApproved: true } });
  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(outputs(dir), []);
});

test('L3: 部分批准（无 merges.json）→ 正常执行 transforms', () => {
  const dir = makeProject({
    transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } }],
    corrupt: { removeMerges: true },
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(outputs(dir), ['t1.csv']);
});

test('L3: 数据文件不存在 → 中止', () => {
  const dir = makeProject({
    transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } }],
    data: { 'customers.csv': null },
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(outputs(dir), []);
});

test('L3: approved 全空 → 无事可做成功退出', () => {
  const dir = makeProject({});
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(outputs(dir), []);
});

// ==================== 审计与状态 ====================

test('成功执行后审计一次性记录 transform_executed×N', () => {
  const dir = makeProject({
    transforms: [
      { id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } },
      { id: 't2', source: 'customers.csv', target: 'x', type: 'trim', rule: { column: 'name' } },
    ],
  });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true);
  const evts = auditEvents(dir);
  assert.strictEqual(evts.filter((e) => e.action === 'transform_executed').length, 2);
  // 成功路径事件 = 2 条 transform_executed + 1 条 step_entered（状态机推进到 exec）
  assert.strictEqual(evts.length, 3);
  assert.strictEqual(evts.filter((e) => e.action === 'step_entered').length, 1);
  assert.strictEqual(stateStep(dir), 'exec'); // 状态机推进到 exec
});

// ==================== P2: --transform/--merge 过滤联动 ====================

test('P2: --transform 过滤不执行任何 merge', () => {
  const dir = makeProject({
    transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } }],
    merges: [{ id: 'm1', left: { source: 'customers.csv', key: 'customerId', value: 'c1' }, right: { source: 'orders.csv', key: 'customerId', value: 'X1' }, confidence: 0.9 }],
  });
  const r = execProject(dir, { transformIds: ['t1'] });
  assert.strictEqual(r.ok, true);
  const outs = fs.readdirSync(path.join(dir, 'output')).filter((f) => f.endsWith('.csv')).sort();
  assert.deepStrictEqual(outs, ['t1.csv']); // 只有 t1，无 m1/m1-mapping
  const evts = auditEvents(dir);
  assert.strictEqual(evts.filter((e) => e.action === 'merge_executed').length, 0);
});

test('P2: --merge 过滤不执行任何 transform', () => {
  const dir = makeProject({
    transforms: [{ id: 't1', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'name' } }],
    merges: [{ id: 'm1', left: { source: 'customers.csv', key: 'customerId', value: 'c1' }, right: { source: 'orders.csv', key: 'customerId', value: 'X1' }, confidence: 0.9 }],
  });
  const r = execProject(dir, { mergeIds: ['m1'] });
  assert.strictEqual(r.ok, true);
  const outs = fs.readdirSync(path.join(dir, 'output')).filter((f) => f.endsWith('.csv')).sort();
  assert.deepStrictEqual(outs, ['m1.csv', 'm1-mapping.csv'].sort()); // 顺序不敏感（readdirSync 顺序无保证）
  const evts = auditEvents(dir);
  assert.strictEqual(evts.filter((e) => e.action === 'transform_executed').length, 0);
});
