# 实验报告：transform-rules-semantics

## 结论
H2a **成立**（10 种规则全部可按 §3.6 语义确定性实现）、H2b **成立**（链式执行）、H2c **成立**（失败中止、零副作用铁律可实现）。

## 结果数据
### H2a: 规则语义（17/17 通过）
| 规则 | 用例 | 结果 |
|---|---|---|
| regex_replace | 全局替换 `a12b34`→`a#b#` | ✓ |
| regex_extract | 首组提取 `2026`；无组全匹配 `42`；无匹配 → null | ✓✓✓ |
| map | 命中 `CN`→`中国`；未命中 `JP` 保持原值 | ✓✓ |
| filter | eq；gt 数值比较（`'9'` 正确排除，字符串序会错）；contains 子串 | ✓✓✓ |
| concat | 3 列拼接新列 | ✓ |
| split | 拆分 3 目标列、不足补空串 | ✓ |
| cast | integer 规范化 `007`→`7`；integer 失败 `12.5`→null；boolean `TRUE`→`true`、`yes`→null；date 格式校验 | ✓✓✓✓ |
| lower/upper/trim | 语义独立（lower 不动空白） | ✓✓ |

### H2b: 链式（1/1 通过）
`regex_replace(数字→#)` 后 `upper` 作用于已替换值：`a12b` → `A#B`（规则 2 看到规则 1 产物）。

### H2c: 破坏性（3/3 通过）
| 场景 | 结果 |
|---|---|
| column 不存在 | `✘ [r1] 引用的 column 不存在: ghost`；output 空；state 不变 |
| 正则非法 `(` | `✘ [r2] 正则非法: (`；output 空；state 不变 |
| approved/ 不存在 | `✘ [exec] approved/ 目录不存在`；中止 |

## 与假设对照
- H2a：17/17 用例 actual === expected → **成立**
- H2b：链式输出与手算预期一致 → **成立**
- H2c：3 种非法场景均无产物、state.json 未推进 → **成立**

## 对设计的影响
- exec.js 规则实现方案确认：10 种规则 = 9 个确定性函数 + filter 行级外处理（filter 缩减行集，其他规则逐行变换）
- **filter 比较语义需补 spec**：gt/lt 必须数值比较（可解析数字时），否则 `'9'` vs `'18'` 字符串序错误——实验实现：两侧可 parseFloat 且以数字开头则数值比较，否则字符串序
- **cast 输出形态需补 spec**：CSV 产物全字符串，cast 语义 = 规范化字符串（integer 去前导零、boolean 小写、date 校验），失败置 null（写盘时为空串）
- **regex_extract 无匹配 → null**（spec 未定义，实验采用 null）
- **split 目标列不足 → 空串**（spec 未定义，实验采用空串）
- 零副作用路径确认：validate 前置（column 存在性 + 正则预编译）→ 内存算完统一写盘 → 状态后置推进

## 局限与后续
- 未测：concat 含 null 单元格（实验用 `?? ''` 容错，spec 未定义）
- 未测：filter 链式连续两个 filter 的交互（行集缩减顺序）
- cast 的 date 仅校验前缀格式（`YYYY-MM-DD`），未校验日历合法性（如 `2026-13-99` 会通过）——需 spec 决策

## 环境
- 日期：2026-08-06
- 环境：Node 24.15.0（win32），零依赖
- 复现：`node scripts/run.js`（本目录）
