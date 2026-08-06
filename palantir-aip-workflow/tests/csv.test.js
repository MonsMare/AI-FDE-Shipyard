// tests/csv.test.js — L1 单元测试：公共 CSV 库（RFC 4180）
// 运行: node --test tests/csv.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { parseCsv, stringify, readCsvFile, writeCsvFile } = require('../bin/csv.js');

test('BOM 前缀不污染首个表头', () => {
  const { cols, rows } = parseCsv('\ufeffid,name\r\n1,alice\r\n2,bob\r\n');
  assert.deepStrictEqual(cols, ['id', 'name']);
  assert.deepStrictEqual(rows, [['1', 'alice'], ['2', 'bob']]);
});

test('转义引号 "a""b" 解析为 a"b', () => {
  const { cols, rows } = parseCsv('id,note\r\n1,"say ""hi"""\r\n');
  assert.deepStrictEqual(rows, [['1', 'say "hi"']]);
});

test('引号内嵌换行保留为同一单元格', () => {
  const { rows } = parseCsv('id,text\r\n1,"line1\nline2"\r\n');
  assert.deepStrictEqual(rows, [['1', 'line1\nline2']]);
});

test('数据区空行保留', () => {
  const { rows } = parseCsv('id,name\r\n1,alice\r\n\r\n2,bob\r\n');
  assert.deepStrictEqual(rows, [['1', 'alice'], [''], ['2', 'bob']]);
});

test('常规引用字段（逗号/引号混合）', () => {
  const { cols, rows } = parseCsv('a,b\r\n"x,y","z""q"\r\n');
  assert.deepStrictEqual(cols, ['a', 'b']);
  assert.deepStrictEqual(rows, [['x,y', 'z"q']]);
});

test('stringify 往返一致（逗号/引号/内嵌换行）', () => {
  const input = 'id,name\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,"multi\nline"\r\n';
  const p1 = parseCsv(input);
  const out = stringify(p1.cols, p1.rows);
  const p2 = parseCsv(out);
  assert.deepStrictEqual(p1, p2);
});

test('stringify 对含逗号/引号/换行的值正确转义', () => {
  const out = stringify(['a', 'b'], [['x,y', 'z"q'], ['m\nn', 'plain']]);
  const reparsed = parseCsv(out);
  assert.deepStrictEqual(reparsed, {
    cols: ['a', 'b'],
    rows: [['x,y', 'z"q'], ['m\nn', 'plain']],
  });
});

test('readCsvFile / writeCsvFile 文件往返', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-csv-'));
  const f = path.join(dir, 't.csv');
  writeCsvFile(f, ['id', 'name'], [['1', 'a,b'], ['2', 'c']]);
  const { cols, rows } = readCsvFile(f);
  assert.deepStrictEqual(cols, ['id', 'name']);
  assert.deepStrictEqual(rows, [['1', 'a,b'], ['2', 'c']]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('末行无换行符也能解析', () => {
  const { rows } = parseCsv('a,b\r\n1,2\r\n3,4');
  assert.deepStrictEqual(rows, [['1', '2'], ['3', '4']]);
});
