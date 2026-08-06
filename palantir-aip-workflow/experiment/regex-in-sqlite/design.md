# 实验：regex-in-sqlite

## 背景与动机
exec.js 引擎的核心映射：转换规则（含 `regex_replace`）如何用 node:sqlite 执行。spec 第 4 节声称 "regex_replace→REPLACE"。但 SQLite 内置 `REPLACE()` **不支持正则**——只有字面替换。本实验验证：(a) 这个映射是否可行；(b) 若不可行，node:sqlite 能否注册自定义函数（正则替换）补上；(c) 确认 spec 的映射描述是否错误。

## 待验证假设
- H1: `regex_replace` 规则可以直接映射为 SQLite 的 `REPLACE()`（字面替换）——**预期推翻**（REPLACE 无正则语义）
- H2: node:sqlite 的 `DatabaseSync` 支持 `db.function()` 注册自定义 SQL 函数（JavaScript 实现正则替换）——预期成立

## 变量
- 自变量：SQL 函数（内置 REPLACE vs 自定义 REGEXP_REPLACE）
- 因变量：规则输出是否正确（正则 `\s+` 去空白）
- 控制变量：数据 `"a  b@example.com"`（含连续空格）、正则 `\s+`

## 方法
node:sqlite 内存库，两条路径：
1. 内置 REPLACE：`SELECT REPLACE(email, '\s+', '')`（把正则当字面量）
2. 自定义函数：`db.function('regexp_replace', (col, pattern, repl) => col.replace(new RegExp(pattern, 'g'), repl))`，再 `SELECT regexp_replace(...)`

## 成功标准（执行前定义）
- H1 推翻：REPLACE 输出含 `\s+` 原样未替换（正则未生效）
- H2 成立：自定义函数输出 `ab@example.com`（连续空格被折叠）

## 对设计的影响
- 若 H1 推翻 + H2 成立：spec 第 4 节映射描述需修正——regex_replace 必须走自定义函数，不能走内置 REPLACE；exec.js 设计需加入"SQLite 自定义函数注册层"
- 若 H2 也推翻：regex_replace 需退回纯 JS 逐行处理（引擎混合架构），设计大改
