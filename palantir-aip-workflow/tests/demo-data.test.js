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
  assert.strictEqual(sources.length, 10, '集团层应有 10 个 source 注册');
  for (const f of sources) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, 'sources', f), 'utf8'));
    assert.ok(src.id, `${f} 缺 id`);
    assert.ok(fs.existsSync(src.path), `${f} 的 path 指向不存在: ${src.path}`);
  }
});
