---
name: paip-infer
description: 用 LLM 从 schema 推断 Ontology 语义模型——对象类型、属性、链接类型与描述（对应 Palantir AIP 的 Ontology 语义建模层）。当用户说"生成对象类型"、"建模"、"推断本体"、"从这些表构建语义模型"时使用。
---

# paip-infer: LLM 语义建模

## Overview
对应 Palantir 的 OAG 层：把 schema 推断结果交给 LLM，生成**对象类型**（实体）、**属性**（含主键/标题键）、**链接**（关系）与**语义描述**。产物进入 `staging/`，**必须经 paip-review 人工审查后才能成为正式 Ontology**（Palantir 原则：AI-authored proposals are subject to human validation）。

## When to Use
- 至少一个数据源已完成注册与 schema 推断（paip-source 完成）
- 用户说"生成对象类型"、"让模型帮我建模"、"推断实体"

**When NOT to use:**
- 没有 schema 文件 → 先 `paip:paip-source`
- 用户只想要转换/清洗 → `paip:paip-model`
- 用户想直接手写模型 → 引导手写 JSON 到 staging（LLM 只是加速器，不是必经路径）

## Steps

### 1. 收集输入
- 读 `schemas/*.schema.json`（一个或多个）
- 读 `state.json` 的 `sources` 确认来源

### 2. 构造 LLM 提示（本 skill 的核心）
提示模板（中文或英文均可，与用户语言一致）：

```
你是企业数据建模专家。基于以下 schema 推断结果，生成 Ontology 对象类型模型。

数据源:
<逐源列出：文件名、行数、列（类型、空值率、样本值）>

要求:
1. 对象类型：识别真实世界实体（人/组织/产品/交易/设备等）。不要为每个文件无脑建一个对象——同实体的多源应建模为同一对象。
2. 每个对象: id（PascalCase）、displayName、description（一句话，为什么它是核心实体）、backingSource（哪个数据源支撑）、properties（每列映射为属性，id 用 camelCase，标主键 primaryKey 与标题键 titleKey）。
3. 链接类型: 对象之间的关系（如 Customer --has→ Order），给出 id、left/right 对象、cardinality（1:1/1:N/N:M）。
4. 属性类型: string/integer/number/boolean/date/email 等。
5. 只输出 JSON，不输出解释文字。
```

### 3. 接收并校验 LLM 输出
- 用宿主的 LLM 能力生成（在 Claude Code 中即由你直接生成）
- **校验**：JSON 可解析、每个对象有 id/displayName/properties、主键存在、链接两端对象存在
- 校验失败：要求修正（只给校验错误，不给重写指令）

### 4. 写入 staging
- 落盘前先跑 `--stage` 校验：
```
node <插件根>/bin/validate.js <项目目录> --stage
```
- 失败时展示全部 `✘` 问题，修复后重跑，通过后再写/更新 staging 产物
- 写 `staging/objects.json` 与 `staging/links.json`（格式见 templates/ontology-project/README.md），每个条目 `status: "staged"`、`proposedBy: "paip-infer"`。

### 5. 更新状态与审计
- `state.json`：`objects`/`links` 追加暂存条目（status=staged），`stats.objectsProposed` +N
- 审计：
```
node <插件根>/bin/audit.js log <项目目录> infer objects_proposed staging/objects.json "<N> 个对象类型, <M> 个链接"
```

### 6. 报告
列出建议的对象/链接清单（表格），明确告知：**这是建议，需经 paip-review 人工审查**。询问是否继续生成转换（paip-model）或直接审查（paip-review）。

## Boundaries
- 只写 `staging/`，**绝不**直接写 `approved/`
- 模型输出必须经过 JSON 校验后才落盘
- **不**生成转换逻辑（那是 paip-model）
- **不**做实体合并（那是 paip-entity）

## Resilience
- LLM 输出 JSON 损坏：要求重新生成或手工修复少量字段，不静默丢弃
- 两个源推断出同一实体：合并为同一对象（多 backingSource），并记录到描述
- 列太多（>50）：优先建议业务核心列，其余注明"可后续补充"

## Common Mistakes
- 一个文件一个对象类型的懒建模（应识别真实实体，跨源合并）
- 不标主键/标题键（Ontology 无法落地）
- 直接写 approved/ 跳过审查（这是流水线最重要的纪律）
- 把转换逻辑混进对象模型（转换是 paip-model 的职责）
