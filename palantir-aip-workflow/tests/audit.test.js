// tests/audit.test.js — audit.js 模块接口 + exec 步骤 + schema-infer 改造验证
// 运行: node --test tests/audit.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { addEvent, stepTo, STEPS } = require('../bin/audit.js');

function makeProject(currentStep = 'review') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-audit-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    currentStep,
    steps: { [currentStep]: 'in_progress' },
    lastEventId: 5,
  }));
  return dir;
}

function state(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
}

function events(dir) {
  const f = path.join(dir, 'audit', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('STEPS 含 exec 共 7 步', () => {
  assert.deepStrictEqual(STEPS, ['init', 'source', 'infer', 'model', 'entity', 'review', 'exec']);
});

test('addEvent 递增 lastEventId 并追加事件', () => {
  const dir = makeProject();
  const e1 = addEvent(dir, 'exec', 'transform_executed', 't1', '');
  const e2 = addEvent(dir, 'exec', 'merge_executed', 'm1', '');
  assert.strictEqual(e1.id, 6);
  assert.strictEqual(e2.id, 7);
  assert.strictEqual(state(dir).lastEventId, 7);
  const evts = events(dir);
  assert.strictEqual(evts.length, 2);
  assert.strictEqual(evts[1].action, 'merge_executed');
  assert.strictEqual(evts[1].step, 'exec');
});

test('stepTo 严格顺序推进（review → exec 允许）', () => {
  const dir = makeProject('review');
  const ok = stepTo(dir, 'exec');
  assert.strictEqual(ok, true);
  assert.strictEqual(state(dir).currentStep, 'exec');
});

test('stepTo 跳步被拒且不写任何东西', () => {
  const dir = makeProject('model');
  const before = JSON.stringify(state(dir));
  const ok = stepTo(dir, 'exec'); // model → exec 跳步
  assert.strictEqual(ok, false);
  assert.strictEqual(JSON.stringify(state(dir)), before);
  assert.strictEqual(events(dir).length, 0);
});

test('exec 子命令记录 executed/failed 事件', () => {
  const dir = makeProject('review');
  const script = path.join(__dirname, '..', 'bin', 'audit.js');
  const r = spawnSync(process.execPath, [script, 'exec', dir, 'failed', '规则 t1 失败'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const evts = events(dir);
  assert.strictEqual(evts.length, 1);
  assert.strictEqual(evts[0].action, 'exec_failed');
  assert.strictEqual(evts[0].step, 'exec');
});

test('schema-infer.js 对带 BOM 的 CSV 表头无污染', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-schema-'));
  const csv = path.join(dir, 'bom.csv');
  fs.writeFileSync(csv, '\ufeffid,name\r\n1,alice\r\n');
  const script = path.join(__dirname, '..', 'bin', 'schema-infer.js');
  const r = spawnSync(process.execPath, [script, csv], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.columns.map((c) => c.name), ['id', 'name']); // 无 BOM 污染
  assert.strictEqual(out.rows, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('模板 state/config 含 7 步（含 exec）', () => {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'ontology-project', 'state.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'ontology-project', 'config.json'), 'utf8'));
  const steps = state.steps || config.state.steps;
  assert.deepStrictEqual(Object.keys(steps).sort(), ['entity', 'exec', 'infer', 'init', 'model', 'review', 'source']);
  // 且 audit check 对模板初始化的项目应通过
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-tpl-'));
  fs.cpSync(path.join(__dirname, '..', 'templates', 'ontology-project'), dir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'audit.js'), 'check', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});

// ==================== P5: schema-infer mixed 增强 ====================

test('P5: mixed 类型附带 typeBreakdown 与 dirtyFormats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-schema-'));
  const csv = path.join(dir, 'mixed.csv');
  fs.writeFileSync(csv, 'd\r\n2026-08-05\r\n08/05/2026\r\n05-08-2026\r\nabc\r\n');
  const script = path.join(__dirname, '..', 'bin', 'schema-infer.js');
  const r = spawnSync(process.execPath, [script, csv], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const col = out.columns[0];
  assert.strictEqual(col.inferredType, 'mixed');
  assert.ok(col.typeBreakdown && col.typeBreakdown.date >= 1, '应含日期占比');
  assert.ok(Array.isArray(col.dirtyFormats) && col.dirtyFormats.includes('MM/DD/YYYY'), '应识别日期变体');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P5: 非 mixed 列不输出 typeBreakdown/dirtyFormats（schema 结构稳定）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-schema-'));
  const csv = path.join(dir, 'clean.csv');
  fs.writeFileSync(csv, 'n,s,amount\r\n1,hi,12.5\r\n2,ho,3.25\r\n');
  const script = path.join(__dirname, '..', 'bin', 'schema-infer.js');
  const r = spawnSync(process.execPath, [script, csv], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const col of out.columns) {
    assert.ok(!('typeBreakdown' in col), `非 mixed 列 ${col.name} 不应有 typeBreakdown`);
    assert.ok(!('dirtyFormats' in col), `非 mixed 列 ${col.name} 不应有 dirtyFormats`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
