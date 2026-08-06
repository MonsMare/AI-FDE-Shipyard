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
    "target": "<输出文件或 same>",
    "type": "regex_replace | regex_extract | map | filter | concat | split | format_date | lower | upper | trim | cast",
    "rule": { <与 type 匹配的参数> },
    "column": "<目标列>",
    "description": "<一句话>"
  }
]
只输出 JSON，不输出解释。规则必须确定性（无随机、无 LLM 依赖）。
```

### 3. 校验与落盘
- 校验：type 合法、rule 参数齐全、column 存在
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
