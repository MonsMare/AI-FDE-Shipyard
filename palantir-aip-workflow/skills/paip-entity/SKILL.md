---
name: paip-entity
description: 用 LLM 做实体消解——跨数据源识别同一实体并生成合并建议（对应 Palantir Entity Resolution）。当用户说"实体消解"、"去重"、"这两个源里有重复客户吗"、"合并实体"时使用。
---

# paip-entity: 实体消解

## Overview
对应 Palantir 的 **Entity Resolution**：跨源识别指向同一真实世界实体的记录（同一个人/组织/产品在两个文件里各有一条），生成合并建议（置信度 + 依据）。LLM 负责"识别"，合并的执行仍是确定性规则（如按邮箱 join），人负责最终确认。

## When to Use
- ≥2 个数据源，怀疑有重复实体
- 用户说"去重"、"实体消解"、"合并记录"、"这两个表是不是同一个人"

**When NOT to use:**
- 单一数据源内的重复 → 说明这是数据质量问题，建议 paip-model 做 dedup 转换
- 用户要建模 → `paip:paip-infer`
- 没有明确 join 键候选 → 先做 paip-source/schema 推断

## Steps

### 1. 收集输入
- 读 `schemas/*.schema.json` 找候选 join 键（email/ID/名称类列）
- 读 `staging/objects.json` 确认实体模型（合并要挂在对象上）

### 2. 采样与构造提示
- 从每个源取样本行（≤20 行/源，或 LLM 能处理的大小）
- 提示模板：
```
你是数据治理专家。以下两个数据源的样本可能指向同一真实世界实体。
源 A: <文件名>（样本）
源 B: <文件名>（样本）
候选 join 键: <email/name/...>
任务: 找出跨源匹配的实体对。输出 JSON 数组:
[
  {
    "id": "merge-001",
    "left": {"source": "<A>", "key": "<列>", "value": "<值>"},
    "right": {"source": "<B>", "key": "<列>", "value": "<值>"},
    "confidence": 0.0-1.0,
    "rationale": "<一句话依据>"
  }
]
置信度 ≥0.9 才列出；只输出 JSON。
```

### 3. 校验与落盘
- 校验：JSON 合法、left/right 指向已注册源、confidence 0-1
- 写 `staging/merges.json`，`status: "staged"`、`proposedBy: "paip-entity"`
- **低置信度（<0.9）或无法判定的一律不列入**——宁缺毋滥（Palantir 原则：false positives 比 false negatives 危险）

### 4. 更新状态与审计
- `state.json`：`entityMerges` 追加，`stats.mergesProposed` +N
- 审计：
```
node <插件根>/bin/audit.js log <项目目录> entity merges_proposed staging/merges.json "<N> 条合并建议"
```

### 5. 报告
- 合并建议表：左/右记录、置信度、依据
- 说明合并的执行方式：**键映射替换**（exec.js 构建 右键值→左键值 映射表 → 行级主键替换，左表优先，右表独有列补齐、同名列进 `_right`）
- 提示：合并建议需 paip-review 确认，确认后由 paip-exec 执行

## Boundaries
- 只产出**建议**（置信度 + 依据），不直接改任何数据
- 置信度 <0.9 不列入（可记录到报告尾部"未列入的低置信候选"供人工参考）
- 不执行合并（那是审查后的执行动作，由 paip-review 触发）
- 不生成对象模型（那是 paip-infer）

## Resilience
- 两个源没有共同键：报告"无共同键，无法可靠消解"，建议 paip-model 先生成规范化键列
- 样本数据为空：报告并停止
- LLM 输出置信度普遍偏低：如实报告，不要为提高匹配率放松阈值

## Common Mistakes
- 把置信度 <0.9 的硬凑进来（宁缺毋滥）
- 合并建议直接改数据（必须先审查）
- 忽略了"同源内部也可能有重复"（那是数据质量问题，不是实体消解）
