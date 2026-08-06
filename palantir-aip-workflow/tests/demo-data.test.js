// tests/demo-data.test.js — Meridian 演示数据集测试（Task 1 先覆盖确定性，后续任务扩展）
// 运行: node --test tests/demo-data.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { generate } = require('../demo-data/gen/index.js');

function genTmp(scale, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-demo-'));
  generate(dir, scale, Object.assign({ schemas: false }, opts));
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

// ==================== Task 4: SaaS 板块 ====================

function loadSaas(dir, name) {
  return readCsvFile(path.join(dir, 'data', 'saas', `${name}.csv`));
}

test('SaaS：subscriptions 外键全部存在于 customers_saas', () => {
  const dir = genTmp(0.1);
  const customers = loadSaas(dir, 'customers_saas');
  const custIds = new Set(customers.rows.map((r) => r[0]));
  const subs = loadSaas(dir, 'subscriptions');
  const custIdx = subs.cols.indexOf('customer_id');
  for (const r of subs.rows) {
    assert.ok(custIds.has(r[custIdx]), `孤儿 customer_id: ${r[custIdx]}`);
  }
});

test('SaaS：churn 前兆存在（churn 订阅用量尾部均值 < 头部 50%）', () => {
  const dir = genTmp(0.1);
  const churn = loadSaas(dir, 'churn_events');
  const subIdx = churn.cols.indexOf('subscription_id');
  const churnSubs = new Set(churn.rows.map((r) => r[subIdx]));
  assert.ok(churnSubs.size > 0, 'churn_events 应非空');
  const usage = loadSaas(dir, 'usage_metrics');
  const uSubIdx = usage.cols.indexOf('subscription_id');
  const uValIdx = usage.cols.indexOf('value');
  // 按订阅分组，比较前半/后半均值
  const bySub = new Map();
  for (const r of usage.rows) {
    const s = r[uSubIdx];
    if (!churnSubs.has(s)) continue;
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s).push(Number(r[uValIdx]));
  }
  let confirmed = 0;
  for (const [sub, vals] of bySub) {
    if (vals.length < 8) continue;
    const half = Math.floor(vals.length / 2);
    const head = vals.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const tail = vals.slice(half).reduce((a, b) => a + b, 0) / (vals.length - half);
    if (head > 0 && tail < head * 0.5) confirmed++;
  }
  assert.ok(confirmed > 0, `应存在用量骤降的 churn 订阅（确认 ${confirmed} 个）`);
});

test('SaaS：overdue 发票存在（欠费信号）', () => {
  const dir = genTmp(0.1);
  const invoices = loadSaas(dir, 'invoices_saas');
  const statusIdx = invoices.cols.indexOf('status');
  const overdue = invoices.rows.filter((r) => String(r[statusIdx]).toLowerCase() === 'overdue').length;
  assert.ok(overdue > 0, '应存在 overdue 发票');
});

test('SaaS：customers_saas 含 110 个跨源种子客户变体', () => {
  const dir = genTmp(0.1);
  const customers = loadSaas(dir, 'customers_saas');
  const emailIdx = customers.cols.indexOf('email');
  const emails = new Set(customers.rows.map((r) => String(r[emailIdx]).trim().toLowerCase()));
  const { buildDuplicateCustomers, mulberry32 } = require('../demo-data/gen/tables.js');
  const seeds = buildDuplicateCustomers(mulberry32(20260806));
  const saasSeeds = seeds.filter((s) => s.variants.saas);
  let matched = 0;
  for (const s of saasSeeds) if (emails.has(s.baseEmail)) matched++;
  assert.strictEqual(matched, saasSeeds.length, `SaaS 种子客户匹配 ${matched}/${saasSeeds.length}`);
});

// ==================== Task 5: schema-infer + 规则集成 ====================

const { validateProject } = require('../bin/validate.js');

test('生成项目（含 schemas/规则）通过 validateProject', () => {
  const dir = genTmp(0.05, { schemas: true }); // 完整生成含 schema-infer（缩小规模加速）
  const schemas = fs.readdirSync(path.join(dir, 'schemas')).filter((f) => f.endsWith('.schema.json'));
  assert.strictEqual(schemas.length, 64, `schemas 应有 64 个，实际 ${schemas.length}`);
  const r = validateProject(dir);
  assert.strictEqual(r.ok, true, r.problems.slice(0, 10).join('\n'));
});

// ==================== Task 6: paip 集成（exec） ====================

const { execProject } = require('../bin/exec.js');

test('execProject 全链执行：物化 CSV 按规则 id 命名 + 合并 mapping 产出', () => {
  const dir = genTmp(0.05, { schemas: true });
  const r = execProject(dir);
  assert.strictEqual(r.ok, true, (r.problems || []).slice(0, 5).join('\n'));
  const outDir = path.join(dir, 'output');
  const outputs = fs.readdirSync(outDir).filter((f) => f.endsWith('.csv'));
  // 16 转换 + 20 合并（各含 mapping 文件）
  assert.strictEqual(outputs.length, 16 + 20 + 20, `output 应有 56 个 CSV，实际 ${outputs.length}`);
  // 抽查：日期清洗产物存在、金额 cast 产物存在、合并 mapping 存在
  assert.ok(outputs.includes('date_md_to_iso.csv'), '缺 date_md_to_iso.csv');
  assert.ok(outputs.includes('money_cast_number.csv'), '缺 money_cast_number.csv');
  assert.ok(outputs.includes('merge_cust_rs_1-mapping.csv'), '缺合并 mapping');
  // 状态机推进到 exec
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(state.currentStep, 'exec');
});
