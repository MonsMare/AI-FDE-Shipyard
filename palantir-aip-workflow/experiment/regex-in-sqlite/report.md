# 实验报告：regex-in-sqlite

## 结论
H1 **推翻**（SQLite 内置 REPLACE 不支持正则，spec 第 4 节映射错误）；H2 **成立**（node:sqlite 自定义函数可做正则替换）。另确认自定义函数内 g 标志行为正确（此前"失败"是实验数据设计问题：`(a)(b)` 对 `"a  b"` 本就不匹配）。

## 结果数据
| 路径 | 输入 | 输出 | 正确 |
|---|---|---|---|
| 内置 REPLACE（正则当字面量） | `a  b@example.com` + `\s+` | `a  b@example.com`（未替换） | ✗ |
| 自定义 regexp_replace（g 标志） | `a  b@example.com` + `\s+` | `ab@example.com` | ✓ |
| 自定义 rr_g（相邻 `(a)(b)`） | `ab ab@example.com` | `X X@example.com`（全局 2 处） | ✓ |
| 自定义 rr_nog（无 g） | `ab ab@example.com` | `X ab@example.com`（仅首处） | ✓ |

## 与假设对照
- H1（REPLACE 可映射正则）：数据 → **推翻**。内置 REPLACE 把 `\s+` 当字面量，输出原样。
- H2（node:sqlite 支持自定义正则函数）：数据 → **成立**。`db.function()` 注册的 JS 函数可正确执行正则全局替换。
- 附加：g 标志由 `db.function` 的 JS 实现控制（`new RegExp(p,'g')`），行为与原生 JS 一致，无 sqlite 层差异。

## 对设计的影响
1. **spec 第 4 节映射必须修正**：`regex_replace → 自定义函数 regexp_replace`，不是内置 REPLACE。exec.js 需在初始化时注册 `db.function('regexp_replace', ...)`（含 g 标志、参数顺序 col/pattern/repl）。
2. **exec.js 架构确认**：node:sqlite + 自定义函数注册层是可行路径，无需退回纯 JS 混合架构。引擎设计成立。
3. 新增注意点：自定义函数的**参数绑定**（col/pattern/repl 顺序）必须与 SQL 调用一致；`pattern` 来自规则 JSON，需在 JS 层 try-catch `new RegExp()` 防非法正则（错误处理章节已覆盖）。

## 局限与后续
- 未测：正则性能（大数据量下 JS 正则 vs SQL 内建）、其他规则类型（map/cast 等）的 SQL 映射——均属后续实现验证。
- 未测：非字符串列上的正则（exec 需先 cast）。

## 环境
- 日期：2026-08-05
- 环境：Node 24.15.0，node:sqlite（DatabaseSync）
- 复现：`node scripts/run.js`（本目录）
