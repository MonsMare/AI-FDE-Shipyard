---
name: paip-model
description: 用 LLM 生成确定性数据转换逻辑（对应 Palantir Pipeline Builder 的 Generate：自然语言 → 转换规则，业务逻辑作为确定性工具、不进 prompt）。当用户说"生成转换"、"清洗数据"、"写管道"、"把这两列合并"时使用。
---

# paip-model: LLM 生成转换逻辑

## Overview
对应 Palantir Pipeline Builder 的 **Generate** 能力：用户用自然语言描述想要的转换（"清洗邮箱"、"把日期统一格式"、"拆分全名列"），LLM 输出**确定性规则**（正则/映射/过滤），而不是再让 LLM 逐行处理数据。规则保存后是"确定性工具"——可审计、可复用、不随模型变化漂移。这是 Palantir "logic stays deterministic, LLM orchestrates" 原则的落地。

## When to Use
- 用户说"生成转换"、"清洗这个字段"、"把 A 列和 B 列合并成 C"、"写管道"
- 数据里有脏数据（空白、格式不统一、大小写混乱）

**When NOT to use:**
- 用户要的是实体建模 → `paip:paip-infer`
- 用户要跨源去重 → `paip:paip-entity`
- 用户描述的是非确定性的语义判断（"判断这个客户是否满意"）→ 说明这属于 LLM 应用层（AIP 功能），不是转换逻辑

## Steps

### 1. 确认输入
- 目标数据源（哪个文件/哪列）
- 用户想要的结果（自然语言描述即可）

### 2. 构造 LLM 提示（本 skill 的核心）
```
你是数据管道工程师。基于用户描述，把数据转换写成确定性规则。
数据源: <文件>, 列: <列名+类型>
用户需求: <自然语言>
规则格式（输出 JSON 数组）:
[
  {
    "id": "<camelCase>",
    "source": "<输入文件>",
    "target": "<描述性说明（不控制输出路径）>",
    "type": "regex_replace | regex_extract | map | filter | concat | split | cast | lower | upper | trim",
    "rule": { <与 type 匹配的参数，见下方参数表> },
    "description": "<一句话>"
  }
]
只输出 JSON，不输出解释。规则必须确定性（无随机、无 LLM 依赖）。
```

**规则 type 权威枚举（10 种，与 bin/validate.js 一致）**：

| type | rule 参数 | 行为（确定性） |
|---|---|---|
| `regex_replace` | `pattern`, `replacement`, `column` | 正则全局替换（JS RegExp，g 标志） |
| `regex_extract` | `pattern`, `column` | 提取首个匹配组（无组则全匹配；无匹配置空） |
| `map` | `mappings`（对象：旧值→新值）, `column` | 精确值映射；未命中保持原值 |
| `filter` | `condition`（`{column, op, value}`，op∈`eq/neq/gt/lt/contains`） | 保留满足条件的行（gt/lt 数值比较） |
| `concat` | `columns`（数组）, `targetColumn`, `separator` | 列拼接为新列 |
| `split` | `column`, `separator`, `targetColumns` | 拆分为多列（不足补空串） |
| `cast` | `column`, `targetType`（string/integer/number/boolean/date） | 规范化字符串；失败置空 |
| `lower` / `upper` / `trim` | `column` | 字符串变换 |

- `target` 字段仅描述性（不控制输出路径）；输出按规则 id 命名 `output/<id>.csv`
- 单元格一律为字符串；cast 失败/无匹配的结果为空串（写盘语义）

### 2b. 日期/金额清洗标准模式（先 regex 转标准形，再 cast）
- 日期三格式（`YYYY-MM-DD` / `MM/DD/YYYY` / `DD-MM-YYYY`）统一为 ISO：先用 `regex_replace` 转 ISO，再 `cast`（`targetType: date`）。`replacement` 的 `$1/$2/$3` 组序按匹配顺序，保持月/日语义：
  - `MM/DD/YYYY`：`pattern: ^(\d{2})/(\d{2})/(\d{4})$` → `replacement: $3-$1-$2`（$1=月、$2=日、$3=年）
  - `DD-MM-YYYY`：`pattern: ^(\d{2})-(\d{2})-(\d{4})$` → `replacement: $3-$2-$1`（$1=日、$2=月、$3=年）
  - 已是 `YYYY-MM-DD` 的列可直接 `cast`（可先 `trim` 去空白）
- 金额：先用 `regex_replace` 去货币符号/千分位（`pattern: [$¥€,]` → `replacement: ''`，一并清除 `$¥€` 与千分位逗号），再 `cast`（`targetType: number`）

### 3. 校验与落盘
- 校验：type 合法、rule 参数齐全、column 存在；落盘前先跑 `--stage` 校验：
```
node <插件根>/bin/validate.js <项目目录> --stage
```
- 失败时展示全部 `✘` 问题，修复后重跑，通过后再写/更新 staging 产物
- 写 `staging/transforms.json`（追加），`status: "staged"`、`proposedBy: "paip-model"`
- 对关键转换（如正则），用输入样本验证规则产出符合预期——在报告中给出验证结果

### 4. 更新状态与审计
- `state.json`：`transforms` 追加，`stats.transformsProposed` +N
- 审计：
```
node <插件根>/bin/audit.js log <项目目录> model transforms_proposed staging/transforms.json "<N> 条转换规则"
```

### 5. 报告
- 每条规则：type + 规则内容 + 一句话作用 + 样本验证结果
- 提示：转换在 paip-review 审查通过前不会生效

## Boundaries
- 只生成**确定性规则**——不允许把"让 LLM 判断"写成转换
- 只写 staging/
- 不修改原数据文件（转换是声明，执行在审查后）
- 不建对象类型（那是 paip-infer）

## Resilience
- 用户描述模糊：先问清楚目标输出（一句"你想把结果变成什么样"），再生成
- 正则复杂：用 2-3 个样本验证后呈现给用户，注明边界情况
- 转换与已批准的转换冲突：指出冲突，让用户决定

## Common Mistakes
- 把 LLM 判断写成转换（违反确定性原则——转换应能无 LLM 重放）
- 不验证正则就在 staging 里写上（至少用样本验证一次）
- 一次生成过多规则不做分组说明（用户无法审查）
