// tests/eval.test.js — evals-lite：单条规则效果评估（bin/eval.js）
// evalRule 在临时副本上执行（零副作用），输出执行前后行数/空值数/样本对照。
// 运行: node --test tests/eval.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { evalRule } = require('../bin/eval.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'demo');

// 同 e2e.test.js 的 setupDemo：复制 fixture 到 tmp，重写 sources path 指向副本 data
function setupDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-eval-'));
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

test('evalRule 输出前后对照（trim_name：行数不变、样本含该列前后值）', () => {
  const dir = setupDemo();
  const tf = JSON.parse(fs.readFileSync(path.join(dir, 'approved', 'transforms.json'), 'utf8'));
  const rule = tf.transforms.find((t) => t.id === 'trim_name');
  assert.ok(rule, 'demo 应有 trim_name 规则');

  const r = evalRule(dir, rule);
  assert.ok(r.ok, (r.problems || []).join('; '));
  assert.strictEqual(r.ruleId, 'trim_name');
  assert.strictEqual(r.column, 'name');

  // 前后对照结构
  assert.ok(r.before && r.after, '应输出前后对照');
  assert.strictEqual(r.before.rowCount, 4);
  assert.strictEqual(r.after.rowCount, 4);
  assert.ok(Number.isInteger(r.before.emptyCount) && Number.isInteger(r.after.emptyCount));
  assert.ok(Array.isArray(r.before.samples) && Array.isArray(r.after.samples), '应含样本');
  assert.ok(r.before.samples.length <= 3 && r.after.samples.length <= 3, '样本最多 3 行');

  // changes：trim 不改行数；dirtyDelta 初版为 null（v2.2 补 dirty 模式检测）
  assert.strictEqual(r.changes.rowDelta, 0);
  assert.strictEqual(r.changes.dirtyDelta, null);

  // 样本含该列值且 trim 真实生效（after 无首尾空白）
  assert.ok(r.before.samples.every((s) => s.value !== undefined), '样本应含目标列值');
  assert.ok(r.after.samples.every((s) => s.value === s.value.trim()), 'after 样本应已 trim');

  // 零副作用：原项目无 output/、state 不推进
  assert.strictEqual(fs.existsSync(path.join(dir, 'output')), false, '原项目不应产生 output');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(state.currentStep, 'review', '原项目状态不应推进');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('evalRule 空值率可观察（cast 使非法 age 置空 → emptyDelta=1）', () => {
  const dir = setupDemo();
  // 注入一条 cast 规则 + 把一行 age 改成非法值（validate 只查列存在，不查数据）
  const dataPath = path.join(dir, 'data', 'customers.csv');
  fs.writeFileSync(dataPath, fs.readFileSync(dataPath, 'utf8').replace('c2,Bob,bob@x.com,19,pending', 'c2,Bob,bob@x.com,xx,pending'));
  const tfPath = path.join(dir, 'approved', 'transforms.json');
  const tf = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
  tf.transforms = [{
    id: 'cast_age_check',
    source: 'customers.csv',
    target: '年龄规范化（eval 测试注入）',
    type: 'cast',
    rule: { column: 'age', targetType: 'integer' },
    description: 'eval 测试：非法年龄置空',
    status: 'approved',
  }];
  fs.writeFileSync(tfPath, JSON.stringify(tf, null, 2));

  const r = evalRule(dir, tf.transforms[0]);
  assert.ok(r.ok, (r.problems || []).join('; '));
  assert.strictEqual(r.before.emptyCount, 0, 'before：age 列无空值');
  assert.strictEqual(r.after.emptyCount, 1, 'after：非法 age 置空');
  assert.strictEqual(r.changes.emptyDelta, 1);
  assert.strictEqual(r.changes.rowDelta, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('evalRule validate 失败返回 {ok:false, problems}（不抛异常、不写副本残留）', () => {
  const dir = setupDemo();
  const tfPath = path.join(dir, 'approved', 'transforms.json');
  const tf = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
  tf.transforms = [{
    id: 'ghost_col',
    source: 'customers.csv',
    target: 'eval 失败路径测试',
    type: 'lower',
    rule: { column: 'ghost' }, // 列不存在 → validate 拒绝
    status: 'approved',
  }];
  fs.writeFileSync(tfPath, JSON.stringify(tf, null, 2));

  let r;
  assert.doesNotThrow(() => { r = evalRule(dir, tf.transforms[0]); });
  assert.strictEqual(r.ok, false);
  assert.ok(Array.isArray(r.problems) && r.problems.length > 0);
  assert.strictEqual(fs.existsSync(path.join(dir, 'output')), false, '原项目不应产生 output');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: node bin/eval.js <项目目录> <规则id> 输出对照 JSON（require.main 守卫）', () => {
  const dir = setupDemo();
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'eval.js'), dir, 'trim_name'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.ruleId, 'trim_name');
  assert.ok(out.before && out.after && out.changes);

  // 找不到规则 → 非零退出 + stderr 提示
  const bad = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'eval.js'), dir, 'no_such_rule'], { encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /no_such_rule/);

  fs.rmSync(dir, { recursive: true, force: true });
});
