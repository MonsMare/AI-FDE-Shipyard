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

test('全仓规则枚举表述一致（10 种）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // 纯 Node 实现（跨平台，不依赖 grep）：搜索范围与 brief 的 grep 意图一致，
  // 但 ../spec ../docs 从仓库内 palantir-aip-workflow 一次上级解析（../.. 会越出仓库根，指向仓库外旧副本）
  const root = path.join(__dirname, '..');
  const targets = ['bin', 'skills', 'templates', 'demo-data', 'README.md', path.join('..', 'spec'), path.join('..', 'docs')];
  const bad1 = '9 ' + '种'; // 拼接构造：避免本文件自命中（全仓 grep 零命中口径）
  const bad2 = '九' + '种';
  const hits = [];
  const scan = (rel) => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(full)) scan(path.join(rel, name));
    } else {
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes(bad1) || line.includes(bad2)) hits.push(`${rel}:${i + 1}`);
      });
    }
  };
  for (const t of targets) scan(t);
  assert.strictEqual(hits.length, 0, `仍有旧规则数表述:\n${hits.join('\n')}`);
});
