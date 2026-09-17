// tests/ai-fde.test.js — L2 端到端：AI-FDE 交付产物验证（方向 C 实验沉淀）
// 对象: experiment/ai-fde-pilot/project（AI-FDE 端到端交付包）+ ground-truth.json（埋点真相）
// 验证: 历史教训规避判据——A1 主键唯一 / A2 引用 100% 命中 / A4 ER 覆盖率 ≥90% / B6 负数量信号保留
// 运行: node --test tests/ai-fde.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const { readCsvFile } = require('../bin/csv.js');

const PROJ = path.join(__dirname, '..', 'experiment', 'ai-fde-pilot', 'project');
const GT = path.join(__dirname, '..', 'experiment', 'ai-fde-pilot', 'ground-truth.json');
const DATA = path.join(__dirname, '..', 'experiment', 'ai-fde-pilot', 'data');

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function keySet(csvPath, colIdx) {
  const { cols, rows } = readCsvFile(csvPath);
  const set = new Set();
  for (const r of rows) set.add(r[colIdx]);
  return set;
}

test('AI-FDE 交付资产存在（project + ground-truth）', () => {
  assert.ok(fs.existsSync(path.join(PROJ, 'config.json')), 'project/config.json 缺失');
  assert.ok(fs.existsSync(path.join(PROJ, 'output')), 'project/output 缺失');
  assert.ok(fs.existsSync(GT), 'ground-truth.json 缺失');
  const gt = loadJson(GT);
  assert.strictEqual(gt.totalCrm, 1200);
  assert.strictEqual(gt.totalSaas, 400);
  assert.strictEqual(gt.totalMfg, 200);
});

test('D1: 数据源注册与 schema 推断齐全（≥5 源/5 schema）', () => {
  const sources = fs.readdirSync(path.join(PROJ, 'sources')).filter(f => f.endsWith('.json'));
  const schemas = fs.readdirSync(path.join(PROJ, 'schemas')).filter(f => f.endsWith('.schema.json'));
  assert.ok(sources.length >= 5, `sources ${sources.length} < 5`);
  assert.ok(schemas.length >= 5, `schemas ${schemas.length} < 5`);
});

test('D2/D3: 对象建模与清洗规则产物存在', () => {
  const staging = fs.readdirSync(path.join(PROJ, 'staging'));
  assert.ok(staging.includes('objects.json'), 'objects 缺失');
  assert.ok(staging.includes('transforms.json'), 'transforms 缺失');
  const transforms = loadJson(path.join(PROJ, 'staging', 'transforms.json'));
  const arr = Array.isArray(transforms) ? transforms : (transforms.transforms || []);
  assert.ok(arr.length >= 5, `transforms ${arr.length} < 5`);
});

test('A4: ER 覆盖率 ≥90%（声明 160/埋点 160）', () => {
  const gt = loadJson(GT);
  const merges = loadJson(path.join(PROJ, 'staging', 'merges.json'));
  const arr = Array.isArray(merges) ? merges : (merges.merges || []);
  const declared = new Set(arr.map(m => m.right && m.right.value).filter(v => /^(SAAS|MFG)-\d+$/.test(String(v))));
  const expected = gt.saasDupCount + gt.mfgDupCount; // 160
  assert.ok(declared.size >= expected * 0.9, `ER 声明 ${declared.size} < 期望 ${expected} 的 90%`);
});

test('B6: 负数量信号保留（产物负数量 ≥ 埋点 90%）', () => {
  const gt = loadJson(GT);
  const outDir = path.join(PROJ, 'output');
  let neg = 0;
  for (const f of fs.readdirSync(outDir)) {
    const { cols, rows } = readCsvFile(path.join(outDir, f));
    const q = cols.indexOf('quantity');
    if (q < 0) continue;
    for (const r of rows) if (Number(r[q]) < 0) neg++;
  }
  assert.ok(neg >= gt.expectedNegQty * 0.9, `负数量 ${neg} < 埋点 ${gt.expectedNegQty} 的 90%`);
});

test('A2: 引用命中率 ≥95%（account_id 产物 join 原始 SAAS 键集）', () => {
  const saasKeys = keySet(path.join(DATA, 'saas_accounts.csv'), 0);
  const outDir = path.join(PROJ, 'output');
  let hit = 0, total = 0;
  for (const f of fs.readdirSync(outDir)) {
    const { cols, rows } = readCsvFile(path.join(outDir, f));
    const i = cols.indexOf('account_id');
    if (i < 0) continue;
    for (const r of rows) { total++; if (saasKeys.has(r[i])) hit++; }
  }
  assert.ok(total > 0, '未找到含 account_id 的产物');
  assert.ok(hit / total >= 0.95, `account_id 命中率 ${(hit / total * 100).toFixed(1)}% < 95%`);
});

test('A1: 最终产物主键唯一（5 表 cast 终点产物无重复）', () => {
  const finals = {
    customer_id: 'crm_created_date_cast.csv',
    account_id: 'saas_signup_date_cast.csv',
    subscription_id: 'subs_end_date_cast.csv',
    supplier_id: 'mfg_since_date_cast.csv',
    shipment_id: 'ship_arrival_date_cast.csv',
  };
  for (const [pk, f] of Object.entries(finals)) {
    const { cols, rows } = readCsvFile(path.join(PROJ, 'output', f));
    const i = cols.indexOf(pk);
    assert.ok(i >= 0, `${f} 无主键列 ${pk}`);
    const seen = new Set();
    for (const r of rows) {
      assert.ok(r[i] !== '' && !seen.has(r[i]), `${f} 主键 ${pk} 重复或空`);
      seen.add(r[i]);
    }
  }
});
