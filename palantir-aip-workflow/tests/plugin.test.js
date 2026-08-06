// tests/plugin.test.js — 插件注册表校验：JSON 合法、8 个 skill、路径存在、无重复
// 运行: node --test tests/plugin.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

test('plugin.json 合法且注册 8 个 skill（含 paip-exec）', () => {
  const p = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
  const plugin = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(plugin.name, 'palantir-aip-workflow');
  assert.ok(Array.isArray(plugin.skills));
  assert.strictEqual(plugin.skills.length, 8);
  const names = plugin.skills.map((s) => s.name);
  assert.deepStrictEqual(names, ['paip-init', 'paip-source', 'paip-infer', 'paip-model', 'paip-entity', 'paip-review', 'paip-visualize', 'paip-exec']);
  assert.strictEqual(new Set(names).size, 8, 'skill 名不可重复');
});

test('每个 skill 的 path 存在且为 SKILL.md', () => {
  const p = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
  const plugin = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const s of plugin.skills) {
    const f = path.join(__dirname, '..', s.path);
    assert.ok(fs.existsSync(f), `${s.name} 的 SKILL.md 缺失: ${s.path}`);
    assert.ok(s.path.endsWith('SKILL.md'));
    assert.ok(s.description && s.description.length > 10, `${s.name} 缺 description`);
  }
});
