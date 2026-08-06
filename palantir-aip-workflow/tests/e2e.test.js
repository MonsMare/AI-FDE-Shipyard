// tests/e2e.test.js — L2 端到端：demo 项目走完整流水线（spec §6 L2）
// fixtures/demo 复制到临时目录（重写 sources path）→ validate → exec → 断言产物/审计/状态
// 运行: node --test tests/e2e.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { validateProject } = require('../bin/validate.js');
const { execProject } = require('../bin/exec.js');
const { readCsvFile } = require('../bin/csv.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'demo');

function setupDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-e2e-'));
  // 复制 fixture（排除 sources 里的 path 占位，写入真实路径）
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const dataDir = path.join(dir, 'data');
  for (const name of fs.readdirSync(path.join(dir, 'sources'))) {
    const p = path.join(dir, 'sources', name);
    const src = JSON.parse(fs.readFileSync(p, 'utf8'));
    src.path = path.join(dataDir, path.basename(src.path.replace('REPLACE_ME/', '')));
    fs.writeFileSync(p, JSON.stringify(src, null, 2));
  }
  return dir;
}

test('L2: validate 通过 demo 项目', () => {
  const dir = setupDemo();
  const r = validateProject(dir);
  assert.strictEqual(r.ok, true, r.problems.join('; '));
});

test('L2: exec 全流水线——物化 CSV + 审计 + 状态推进', () => {
  const dir = setupDemo();
  const r = execProject(dir);
  assert.strictEqual(r.ok, true, (r.problems || []).join('; '));

  // 产物清单：5 transform + 1 merge + 1 mapping
  const outputs = fs.readdirSync(path.join(dir, 'output')).sort();
  assert.deepStrictEqual(outputs, ['active_only.csv', 'cast_age.csv', 'full_name.csv', 'lower_email.csv', 'merge-001-mapping.csv', 'merge-001.csv', 'trim_name.csv']);

  // 转换真实生效（trim）
  const { rows: trimRows } = readCsvFile(path.join(dir, 'output', 'trim_name.csv'));
  assert.deepStrictEqual(trimRows.map((x) => x[1]), ['Alice', 'Bob', 'Carol', 'Dave']);

  // 链式：full_name 看到 lower_email 的产物（email 已小写）
  const { cols: fullCols, rows: fullRows } = readCsvFile(path.join(dir, 'output', 'full_name.csv'));
  const fullIdx = fullCols.indexOf('full');
  assert.deepStrictEqual(fullRows.map((x) => x[fullIdx]), ['Alice <alice@x.com', 'Bob <bob@x.com', 'Carol <carol@x.com', 'Dave <dave@x.com']);

  // filter 生效（只留 active：c1/c3）
  const { rows: filterRows } = readCsvFile(path.join(dir, 'output', 'active_only.csv'));
  assert.deepStrictEqual(filterRows.map((x) => x[0]), ['c1', 'c3']);

  // 合并：orders 的 X1 行主键归并到 c1，name 冲突 _right，amount 独有补入
  // 注意：active_only filter 先缩减 customers 表（链式语义：merge 作用于已清洗数据），
  // 左表只剩 c1/c3 两行，故合并表 = 2 + 1 = 3 行
  const { cols: mCols, rows: mRows } = readCsvFile(path.join(dir, 'output', 'merge-001.csv'));
  assert.strictEqual(mRows.length, 3);
  const mergedOrder = mRows.find((x) => x[mCols.indexOf('orderId')] === 'o2');
  assert.ok(mergedOrder, 'o2 行应并入');
  assert.strictEqual(mergedOrder[mCols.indexOf('customerId')], 'c1');
  assert.strictEqual(mergedOrder[mCols.indexOf('name')], 'Alice'); // 左表优先
  assert.strictEqual(mergedOrder[mCols.indexOf('name_right')], 'ALICE-v2');
  assert.strictEqual(mergedOrder[mCols.indexOf('amount')], '20.0');
  // mapping 表
  const mapping = readCsvFile(path.join(dir, 'output', 'merge-001-mapping.csv'));
  assert.deepStrictEqual(mapping.rows, [['X1', 'c1']]);

  // 审计一次性记录：5 transform_executed + 1 merge_executed + 1 step_entered
  const audit = fs.readFileSync(path.join(dir, 'audit', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(audit.filter((e) => e.action === 'transform_executed').length, 5);
  assert.strictEqual(audit.filter((e) => e.action === 'merge_executed').length, 1);
  assert.strictEqual(audit.length, 7);

  // 状态机推进到 exec
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(state.currentStep, 'exec');
});

test('L2: 破坏性注入——非法规则被拒且零副作用', () => {
  const dir = setupDemo();
  // 注入一条 column 不存在的规则
  const tfPath = path.join(dir, 'approved', 'transforms.json');
  const tf = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
  tf.transforms.push({ id: 'bad', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'ghost' }, status: 'approved' });
  fs.writeFileSync(tfPath, JSON.stringify(tf, null, 2));

  const r = execProject(dir);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'output')), false); // 无 output 目录
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(state.currentStep, 'review'); // 状态不推进
  // 审计只记 exec_failed
  const audit = fs.readFileSync(path.join(dir, 'audit', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(audit.length, 1);
  assert.strictEqual(audit[0].action, 'exec_failed');
});
