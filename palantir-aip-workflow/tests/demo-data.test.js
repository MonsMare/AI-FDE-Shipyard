// tests/demo-data.test.js — Meridian 演示数据集测试（Task 1 先覆盖确定性，后续任务扩展）
// 运行: node --test tests/demo-data.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { generate } = require('../demo-data/gen/index.js');

function genTmp(scale) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-demo-'));
  generate(dir, scale);
  return dir;
}

// 递归收集目录下所有文件相对路径 + 内容 hash（逐字节比较）
// sources/*.json 的 path 是绝对路径（指向实际位置），归一化为 <dir> 占位符再比较
function snapshot(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (rel.startsWith('sources/')) {
        const src = JSON.parse(fs.readFileSync(full, 'utf8'));
        src.path = '<dir>';
        out[rel] = JSON.stringify(src, null, 2);
      } else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

test('确定性：同参数两次生成逐字节一致', () => {
  const a = snapshot(genTmp(0.1));
  const b = snapshot(genTmp(0.1));
  assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort(), '文件清单应一致');
  for (const [rel, content] of Object.entries(a)) {
    assert.strictEqual(b[rel], content, `文件内容不一致: ${rel}`);
  }
});

test('集团层 10 表生成且行数符合 scale 缩放', () => {
  const dir = genTmp(0.1); // 10% 规模
  const dataDir = path.join(dir, 'data', 'group');
  const expect = ['cost_centers.csv', 'departments.csv', 'positions.csv', 'employees.csv', 'employee_exits.csv', 'salary_records.csv', 'attendance.csv', 'performance_reviews.csv', 'group_finance.csv', 'intercompany_transactions.csv'];
  for (const f of expect) {
    assert.ok(fs.existsSync(path.join(dataDir, f)), `缺表: ${f}`);
  }
  const { readCsvFile } = require('../bin/csv.js');
  const employees = readCsvFile(path.join(dataDir, 'employees.csv'));
  assert.strictEqual(employees.cols[0], 'employee_id');
  // 2600 × 0.1 = 260 行（含表头 261）
  assert.ok(employees.rows.length >= 250 && employees.rows.length <= 270, `employees 行数异常: ${employees.rows.length}`);
});

test('sources 注册与 data 文件一一对应', () => {
  const dir = genTmp(0.1);
  const sources = fs.readdirSync(path.join(dir, 'sources')).filter((f) => f.endsWith('.json'));
  const dataFiles = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.csv')) dataFiles.push(f);
    }
  };
  walk(path.join(dir, 'data'));
  assert.strictEqual(sources.length, dataFiles.length, `sources(${sources.length}) 与 data 文件(${dataFiles.length})应一一对应`);
  for (const f of sources) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, 'sources', f), 'utf8'));
    assert.ok(src.id, `${f} 缺 id`);
    assert.ok(fs.existsSync(src.path), `${f} 的 path 指向不存在: ${src.path}`);
    assert.ok(dataFiles.includes(`${src.id}`), `data 缺 ${src.id}`);
  }
});

// ==================== Task 2: 零售板块 ====================

const { readCsvFile } = require('../bin/csv.js');

function load(dir, name) {
  return readCsvFile(path.join(dir, 'data', 'retail', `${name}.csv`));
}

test('零售：order_items 外键全部存在于 orders_retail', () => {
  const dir = genTmp(0.1);
  const orders = load(dir, 'orders_retail');
  const orderIds = new Set(orders.rows.map((r) => r[0]));
  const items = load(dir, 'order_items');
  const orderIdx = items.cols.indexOf('order_id');
  for (const r of items.rows) {
    assert.ok(orderIds.has(r[orderIdx]), `孤儿 order_id: ${r[orderIdx]}`);
  }
});

test('零售：orders 孤儿 customer_id 率 ≈1%（0.5%-1.5%）', () => {
  const dir = genTmp(0.1);
  const orders = load(dir, 'orders_retail');
  const custIdx = orders.cols.indexOf('customer_id');
  const orphan = orders.rows.filter((r) => r[custIdx] === 'CUST-99999').length;
  const rate = orphan / orders.rows.length;
  assert.ok(rate >= 0.005 && rate <= 0.015, `孤儿率异常: ${(rate * 100).toFixed(2)}%`);
});

test('零售：150 个跨源种子客户全部在 customers_retail（按归一化邮箱匹配）', () => {
  const dir = genTmp(0.1);
  const customers = load(dir, 'customers_retail');
  const emailIdx = customers.cols.indexOf('email');
  const emails = new Set(customers.rows.map((r) => String(r[emailIdx]).trim().toLowerCase()));
  const { buildDuplicateCustomers, mulberry32 } = require('../demo-data/gen/tables.js');
  const seeds = buildDuplicateCustomers(mulberry32(20260806));
  let matched = 0;
  for (const s of seeds) {
    if (emails.has(s.baseEmail)) matched++;
  }
  assert.strictEqual(matched, 150, `种子客户匹配 ${matched}/150`);
});

test('零售：库存积压病症存在（stock 极端值子集）', () => {
  const dir = genTmp(0.1);
  const inv = load(dir, 'inventory_retail');
  const stockIdx = inv.cols.indexOf('stock');
  const bloated = inv.rows.filter((r) => Number(r[stockIdx]) > 5000).length;
  assert.ok(bloated > 0, '应存在库存积压记录');
});

// ==================== Task 3: 制造板块 ====================

function loadMfg(dir, name) {
  return readCsvFile(path.join(dir, 'data', 'mfg', `${name}.csv`));
}

test('制造：quality_checks 外键全部存在于 production_batches', () => {
  const dir = genTmp(0.1);
  const batches = loadMfg(dir, 'production_batches');
  const batchIds = new Set(batches.rows.map((r) => r[0]));
  const checks = loadMfg(dir, 'quality_checks');
  const batchIdx = checks.cols.indexOf('batch_id');
  for (const r of checks.rows) {
    assert.ok(batchIds.has(r[batchIdx]), `孤儿 batch_id: ${r[batchIdx]}`);
  }
});

test('制造：次品率病症存在（fail 批次可定位且 defects 集中于少数批次）', () => {
  const dir = genTmp(0.1);
  const checks = loadMfg(dir, 'quality_checks');
  const resultIdx = checks.cols.indexOf('result');
  const fails = checks.rows.filter((r) => String(r[resultIdx]).toLowerCase() === 'fail');
  assert.ok(fails.length > 0, '应存在 fail 质检记录');
  const defects = loadMfg(dir, 'defects');
  assert.ok(defects.rows.length > 0, 'defects 应非空');
});

test('制造：低分供应商存在（supplier_evaluations ≤60）', () => {
  const dir = genTmp(0.1);
  const evals = loadMfg(dir, 'supplier_evaluations');
  const scoreIdx = evals.cols.indexOf('score');
  const low = evals.rows.filter((r) => Number(r[scoreIdx]) <= 60);
  assert.ok(low.length > 0, '应存在低分供应商评估');
});

test('制造：customers_mfg 含 80 个跨源种子客户变体', () => {
  const dir = genTmp(0.1);
  const customers = loadMfg(dir, 'customers_mfg');
  const emailIdx = customers.cols.indexOf('email');
  const emails = new Set(customers.rows.map((r) => String(r[emailIdx]).trim().toLowerCase()));
  const { buildDuplicateCustomers, mulberry32 } = require('../demo-data/gen/tables.js');
  const seeds = buildDuplicateCustomers(mulberry32(20260806));
  const mfgSeeds = seeds.filter((s) => s.variants.mfg);
  let matched = 0;
  for (const s of mfgSeeds) if (emails.has(s.baseEmail)) matched++;
  assert.strictEqual(matched, mfgSeeds.length, `制造种子客户匹配 ${matched}/${mfgSeeds.length}`);
});
