---
name: paip-source
description: 注册数据源（联邦接入，不复制数据）并运行确定性 schema 推断。当用户说"注册数据源"、"接入数据"、"推断 schema"、"把这份 CSV 加进来"时使用。
---

# paip-source: 数据源注册与 schema 推断

## Overview
对应 Palantir 的 Ontology Hydration 第一步：把数据源"联邦接入"项目（**引用路径，不复制数据**），然后用内核工具做确定性 schema 推断（列名、类型、空值率、样本、去重计数）。推断产物（schema JSON）是后续 paip-infer 语义建模的输入。

## When to Use
- 用户提供数据文件（CSV/JSON/JSONL）要求接入
- 用户说"推断这个文件的 schema"、"看看这些列是什么类型"
- 新项目刚 init 完，要注册第一个源

**When NOT to use:**
- 用户要求生成对象类型/建模 → `paip:paip-infer`（先有 schema 才能建模）
- 用户要求清洗/转换数据 → `paip:paip-model`
- 没有实际数据文件，只有口头描述 → 说明需要数据文件（或建议先手工写 schema）

## Steps

### 1. 确认数据文件
- 支持格式：.csv / .json（数组）/ .jsonl
- **联邦引用**：记录文件绝对路径到 `sources/<name>.json`，**不复制文件内容进项目**（Palantir 原则：without duplicating the underlying data）
- 若用户希望复制（演示/测试数据），复制到 `data/` 并在注册信息里注明 `copied: true`

### 2. 注册数据源
写 `sources/<name>.json`：
```json
{
  "id": "<name>",
  "path": "<绝对路径>",
  "format": "csv",
  "registeredAt": "<ISO 日期>",
  "description": "<用户提供或推断>",
  "copied": false
}
```

### 3. 运行 schema 推断
```
node <插件根>/bin/schema-infer.js <数据文件路径> [--sample 5]
```
输出写入 `schemas/<name>.schema.json`（原样保存推断结果）。

### 4. 更新状态与审计
- 更新 `state.json`：`sources` 数组追加注册信息，`stats.sourcesRegistered` +1
- 登记审计事件：
```
node <插件根>/bin/audit.js log <项目目录> source source_registered <源名> "<列数> 列, <行数> 行"
```

### 5. 报告
给用户一个简洁的 schema 摘要表（列名 | 推断类型 | 空值率 | 样本值 | 去重数），并询问下一步（生成对象类型 → `paip:paip-infer`）。

## Boundaries
- 只做注册 + schema 推断，**不**调用 LLM
- **不**修改数据文件本身
- **不**建对象类型（那是 paip-infer 的事）
- 多个源逐个注册，每个源独立一个 schema 文件

## Resilience
- 文件不存在/不可读：报错并停止，不改 state.json（obra 铁律：失败时绝不推进状态，避免下次误判）
- 空文件/单行文件：schema-infer 会报错，如实转达
- 类型推断为 mixed：正常（如实记录，LLM 建模时处理）

## Common Mistakes
- 把数据复制进项目（默认应联邦引用；除非演示数据）
- 手工改 schema 推断结果（schema 是事实，建模才是解释）
- 一个源没注册成功就推进到 infer
