// regex-in-sqlite 实验脚本
// 验证 node:sqlite 的 REPLACE 与自定义正则函数行为
// 运行: node scripts/run.js
'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

db.exec("CREATE TABLE t (email TEXT)");
db.prepare("INSERT INTO t (email) VALUES (?)").run("a  b@example.com");

// 路径1: 内置 REPLACE（把正则当字面量）
const r1 = db.prepare("SELECT REPLACE(email, '\\s+', '') AS out FROM t").get();
console.log(JSON.stringify({ path: 'builtin REPLACE with regex pattern', output: r1.out, correct: r1.out === 'ab@example.com' }));

// 路径2: 自定义函数
db.function('regexp_replace', (col, pattern, repl) => String(col).replace(new RegExp(pattern, 'g'), repl));
const r2 = db.prepare("SELECT regexp_replace(email, '\\s+', '') AS out FROM t").get();
console.log(JSON.stringify({ path: 'custom regexp_replace function', output: r2.out, correct: r2.out === 'ab@example.com' }));

// 额外: 自定义函数支持非捕获组/标志
db.function('regexp_replace_g', (col, pattern, repl) => String(col).replace(new RegExp(pattern, 'g'), repl));
const r3 = db.prepare("SELECT regexp_replace_g(email, '(a)(b)', 'X') AS out FROM t").get();
console.log(JSON.stringify({ path: 'custom fn with capture group', output: r3.out, correct: r3.out === 'X  X@example.com' }));
