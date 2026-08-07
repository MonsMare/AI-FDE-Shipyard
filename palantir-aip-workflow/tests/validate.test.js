// tests/validate.test.js — L1 单元测试：产物格式校验器（spec §3.2）
// 运行: node --test tests/validate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { validateProject } = require('../bin/validate.js');

// 构造最小合法项目 fixture；opts 可覆盖/追加产物
function makeProject({ objects, links, transforms, merges, extra } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-val-'));
  const write = (rel, obj) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(obj, null, 2));
  };
  write('sources/customers.csv.json', { id: 'customers.csv', path: path.join(dir, 'data', 'customers.csv'), format: 'csv' });
  write('sources/orders.csv.json', { id: 'orders.csv', path: path.join(dir, 'data', 'orders.csv'), format: 'csv' });
  write('schemas/customers.csv.schema.json', {
    file: 'customers.csv',
    columns: [
      { name: 'customerId', inferredType: 'string' },
      { name: 'name', inferredType: 'string' },
      { name: 'email', inferredType: 'email' },
    ],
  });
  write('schemas/orders.csv.schema.json', {
    file: 'orders.csv',
    columns: [
      { name: 'orderId', inferredType: 'string' },
      { name: 'customerId', inferredType: 'string' },
      { name: 'amount', inferredType: 'number' },
    ],
  });
  write('approved/objects.json', objects || {
    objects: [
      {
        id: 'Customer', displayName: '客户', description: '购买者',
        backingSource: 'customers.csv',
        properties: [
          { id: 'customerId', type: 'string', title: '客户 ID', primaryKey: true },
          { id: 'name', type: 'string', title: '姓名' },
          { id: 'email', type: 'string', title: '邮箱' },
        ],
        status: 'approved',
      },
      {
        id: 'Order', displayName: '订单', description: '订单',
        backingSource: 'orders.csv',
        properties: [
          { id: 'orderId', type: 'string', title: '订单 ID', primaryKey: true },
          { id: 'customerId', type: 'string', title: '客户 ID' },
          { id: 'amount', type: 'number', title: '金额' },
        ],
        status: 'approved',
      },
    ],
  });
  write('approved/links.json', links || {
    links: [
      { id: 'Customer_orders', source: 'Customer', target: 'Order', cardinality: '1:N', status: 'approved' },
    ],
  });
  write('approved/transforms.json', transforms || {
    transforms: [
      {
        id: 'normalize_email', source: 'customers.csv', target: '清洗邮箱（描述性）',
        type: 'regex_replace', rule: { pattern: '\\s+', replacement: '', column: 'email' },
        description: '去除邮箱空白', status: 'approved',
      },
    ],
  });
  write('approved/merges.json', merges || {
    merges: [
      {
        id: 'merge-001',
        left: { source: 'customers.csv', key: 'email', value: 'a@x.com' },
        right: { source: 'orders.csv', key: 'customerId', value: 'c1' },
        confidence: 0.93, rationale: '邮箱一致', status: 'approved',
      },
    ],
  });
  if (extra) {
    for (const [rel, obj] of Object.entries(extra)) write(rel, obj);
  }
  return dir;
}

test('合法产物 → ok:true 且 0 问题', () => {
  const dir = makeProject();
  const r = validateProject(dir);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.problems, []);
});

test('对象缺主键 → 报错', () => {
  const dir = makeProject({
    objects: {
      objects: [{
        id: 'Customer', displayName: '客户', description: 'x',
        backingSource: 'customers.csv',
        properties: [{ id: 'customerId', type: 'string', title: '客户 ID' }], // 无 primaryKey
        status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('Customer') && p.includes('主键')));
});

test('链接指向不存在对象 → 报错', () => {
  const dir = makeProject({
    links: {
      links: [{ id: 'L1', source: 'Customer', target: 'Ghost', cardinality: '1:N', status: 'approved' }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('Ghost')));
});

test('cardinality 非法 → 报错', () => {
  const dir = makeProject({
    links: {
      links: [{ id: 'L1', source: 'Customer', target: 'Order', cardinality: '1:X', status: 'approved' }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('1:X')));
});

test('transform type 非法 → 报错', () => {
  const dir = makeProject({
    transforms: {
      transforms: [{
        id: 't1', source: 'customers.csv', target: 'x', type: 'magic',
        rule: { column: 'email' }, status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('magic')));
});

test('transform rule 参数缺失 → 报错', () => {
  const dir = makeProject({
    transforms: {
      transforms: [{
        id: 't1', source: 'customers.csv', target: 'x', type: 'regex_replace',
        rule: { pattern: '\\s+' }, // 缺 replacement 和 column
        status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('replacement')));
});

test('transform column 不存在（对照 schema）→ 报错', () => {
  const dir = makeProject({
    transforms: {
      transforms: [{
        id: 't1', source: 'customers.csv', target: 'x', type: 'lower',
        rule: { column: 'ghostCol' }, status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('ghostCol')));
});

test('transform source 未注册 → 报错', () => {
  const dir = makeProject({
    transforms: {
      transforms: [{
        id: 't1', source: 'ghost.csv', target: 'x', type: 'lower',
        rule: { column: 'email' }, status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('ghost.csv')));
});

test('merge confidence 越界 → 报错', () => {
  const dir = makeProject({
    merges: {
      merges: [{
        id: 'm1',
        left: { source: 'customers.csv', key: 'email', value: 'a@x.com' },
        right: { source: 'orders.csv', key: 'customerId', value: 'c1' },
        confidence: 1.5, rationale: 'x', status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('confidence')));
});

test('merge 的 key 不在对应 schema 列中 → 报错', () => {
  const dir = makeProject({
    merges: {
      merges: [{
        id: 'm1',
        left: { source: 'customers.csv', key: 'ghostKey', value: 'a@x.com' },
        right: { source: 'orders.csv', key: 'customerId', value: 'c1' },
        confidence: 0.9, rationale: 'x', status: 'approved',
      }],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('ghostKey')));
});

test('多问题聚合列出（不中断）', () => {
  const dir = makeProject({
    transforms: {
      transforms: [
        { id: 't1', source: 'ghost.csv', target: 'x', type: 'magic', rule: {}, status: 'approved' },
        { id: 't2', source: 'customers.csv', target: 'x', type: 'lower', rule: { column: 'nope' }, status: 'approved' },
      ],
    },
  });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.length >= 3); // t1: type+source；t2: column
});

test('某规则文件缺失 → 跳过该类型，不报错', () => {
  const dir = makeProject({ merges: null });
  fs.rmSync(path.join(dir, 'approved', 'merges.json'));
  const r = validateProject(dir);
  assert.strictEqual(r.ok, true);
});

test('--stage 模式：staging 链接可指向 approved 对象（基准）', () => {
  const dir = makeProject();
  // staging 里一条链接指向 approved 的 Customer
  fs.mkdirSync(path.join(dir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staging', 'links.json'), JSON.stringify({
    links: [{ id: 'L2', source: 'Customer', target: 'Order', cardinality: 'N:M', status: 'staged' }],
  }));
  const r = validateProject(dir, { stage: true });
  assert.strictEqual(r.ok, true);
});

test('approved 目录不存在 → 报错', () => {
  const dir = makeProject();
  fs.rmSync(path.join(dir, 'approved'), { recursive: true, force: true });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('approved')));
});

test('P3: --stage 模式在无 approved/ 时可校验 staging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-val-'));
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources', 'a.csv.json'), JSON.stringify({ id: 'a.csv', path: 'x', format: 'csv' }));
  fs.writeFileSync(path.join(dir, 'schemas', 'a.csv.schema.json'), JSON.stringify({ file: 'a.csv', columns: [{ name: 'id' }, { name: 'name' }] }));
  fs.mkdirSync(path.join(dir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staging', 'objects.json'), JSON.stringify({
    objects: [{
      id: 'A', displayName: 'A', backingSource: 'a.csv',
      properties: [{ id: 'id', type: 'string', title: 'ID', primaryKey: true }, { id: 'name', type: 'string', title: '名' }],
      status: 'staged',
    }],
  }));
  const r = validateProject(dir, { stage: true });
  assert.strictEqual(r.ok, true, r.problems.join('; ')); // 无 approved 也应通过
});

test('P8: 对象属性覆盖 backingSource 全部列（缺列报错）', () => {
  const dir = makeProject({ objects: { objects: [{ id: 'Customer', displayName: '客户', description: 'x', backingSource: 'customers.csv', properties: [{ id: 'customerId', type: 'string', title: 'ID', primaryKey: true }], status: 'approved' }] } });
  const r = validateProject(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('列未映射') || p.includes('name')));
});
