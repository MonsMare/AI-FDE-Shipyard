# Palantir AIP 流水线工程办法提炼（engineering-principles）

> 从 Palantir AIP（Foundry AI OS）整套流水线中提炼**根本性工程办法**，以及我们在 paip 插件中的对应实现。
> 依据：`palantir-like-workflow/README.md`（一手资料调研）、`spec/2026-08-05-paip-engineering-design.md`（设计）、`experiment/`（可行性实验）。

| # | Palantir 环节 | 根本性工程办法 | 为什么 | 我们的对应 |
|---|---|---|---|---|
| 1 | 联邦接入 | **data-in-place：引用不复制** | 复制 = 第二真相源；联邦保留原系统权威 | `paip-source`（sources/*.json 记录路径） |
| 2 | Schema 推断 | **确定性前置** | 建模前先知道"有什么"；推断是事实，建模是解释 | `bin/schema-infer.js` |
| 3 | 逻辑确定性化 | **逻辑作为确定性工具，不进 prompt** | LLM 推理不可审计不可重放；规则可测试可替换 | `paip-model`（规则 JSON） |
| 4 | 两段式提交 | **AI 出提案 → 人裁决 → 才生效** | 错误结构比没有结构更贵；human-in-the-loop | `paip-infer → paip-review` |
| 5 | 全量审计 | **动作可审计，拒绝也留痕** | 合规与回滚基础；who-did-what-when 不可丢 | `bin/audit.js`（audit.jsonl） |
| 6 | 实体消解 | **置信度阈值宁缺毋滥** | false positive 比 false negative 危险 | `paip-entity`（≥0.9） |
| 7 | 执行引擎 | **规则真的跑在数据上** | 声明不产生价值，物化才产生 | `bin/exec.js`（纯 JS 行级） |
| 8 | 可视化审查 | **图是审查的输入** | 结构错误一眼可见 | `paip-visualize` |
| 9 | 产物校验 | **格式先于执行校验** | 坏格式规则比没有规则更危险 | `bin/validate.js` |

---

## 1. 联邦接入：data-in-place

**Palantir 做法**：外部数据源（BigQuery/Snowflake/S3）联邦直连，"without duplicating the underlying data"。

**根本办法**：数据留在原地，注册的是**引用**（路径 + 格式 + 元数据），不是数据本身。

**为什么**：复制会产生第二真相源——原系统更新了，副本不知道；两份数据谁权威？联邦引用让"权威"永远只有一个（原系统），管道只消费。

**我们**：`paip-source` 写 `sources/<name>.json`（id/path/format），引擎按 path 读取。要复制（演示场景）需显式声明 `copied: true`——复制是例外，不是默认。

## 2. Schema 推断：确定性前置

**Palantir 做法**：Pipeline Builder "Infer a schema for CSV/JSON"；Ontology Manager 自动映射列。

**根本办法**：建模之前，先确定性回答"数据里有什么"（列、类型、空值率、去重计数）——用脚本，不用 LLM。

**为什么**：推断是**事实**（数据里有什么），建模是**解释**（这些列意味着什么）。事实用确定性工具拿，解释才交给 LLM——LLM 看到的是事实快照，不会把"看着像"当"就是"。

**我们**：`bin/schema-infer.js` 输出列类型/样本/空值率/去重计数到 `schemas/<name>.schema.json`，作为建模与校验的输入。

## 3. 逻辑确定性化：不进 prompt

**Palantir 做法**：Pipeline Builder Generate 用 LLM 生成转换逻辑，但逻辑一旦生成就是普通管道节点——"确定性工具，不是 prompt 的一部分"。

**根本办法**：**逻辑（规则）与推理（LLM）分离**。LLM 只负责"把需求翻译成规则"，规则一旦落盘就是可审计、可重放、可测试的确定性工具。

**为什么**：LLM 逐行处理数据 = 每次结果都可能不同、不可审计、随模型漂移。规则是 JSON + 确定性执行器——结果可预测、可回滚、换模型不漂移。

**我们**：`paip-model` 输出 10 种权威规则（§3.6），`bin/exec.js` 纯 JS 行级执行。**硬约束**：skill 禁止重新实现规则逻辑（防第二真相源）。

## 4. 两段式提交：AI 提案，人裁决

**Palantir 做法**：AI-authored proposals subject to human validation——"human review checkpoints"。

**根本办法**：LLM 产物只进 `staging/`，必须经人工审查才进 `approved/`。**结构错误比没有结构更贵**——进错了 approved 的错误对象类型会污染所有下游。

**为什么**：一次人工审查的成本远低于一次错误结构扩散的成本。审查的对象是"提案 + 依据"，不是让 LLM 自审。

**我们**：`paip-infer` 写 staging → `paip-review` 逐项呈现、用户裁决 → approved（不可变）。拒绝项保留 `status: "rejected"`。

## 5. 全量审计：动作可审计

**Palantir 做法**：动作层审计——权限强制、审计 prompt/tool call/eval/approval/结果。

**根本办法**：每个动作一条事件（who/what/when），**拒绝也留痕**。

**为什么**：合规与回滚的基础。没有审计，"当时为什么这么定"无从追溯；回滚不知道要回滚什么。

**我们**：`bin/audit.js` 追加 `audit/audit.jsonl`（id/ts/step/action/target/detail），状态机推进也留痕（step_entered），exec 成功一次性记录执行事件、失败记录 `exec_failed`。

## 6. 实体消解：置信度宁缺毋滥

**Palantir 做法**：Entity Resolution "link records with AI"；Sovereign AI 原则"宁缺毋滥"。

**根本办法**：置信度低于阈值的匹配**不列入**（我们：≥0.9）。false positive 比 false negative 危险——把两个不同实体合并成一个，数据就污染了；漏合并只是少一条，还能再查。

**为什么**：合并不可逆（主键归并后原记录消失）。宁可漏掉真匹配，不可错合并假匹配。

**我们**：`paip-entity` 只输出 ≥0.9 的匹配对（left/right 各含 source/key/value），低置信度记录在报告尾部供人工参考。

## 7. 执行引擎：规则真的跑在数据上

**Palantir 做法**：Pipeline Builder 后端自动写转换代码并执行——声明与执行是同一平台能力。

**根本办法**：**声明不产生价值，物化才产生**。规则 JSON 是语义 IR，执行引擎让它跑在数据上，产出可消费的物化产物。

**为什么**：一份没人执行的规则 = 文档；一份执行过的规则 = 资产。物化产物（output/ CSV）才是下游消费的东西。

**我们**：`bin/exec.js`——内部强制先校验（validate），10 种规则行级执行（实验确认语义），合并键映射替换，统一写盘 `output/<id>.csv`，成功一次性审计。**铁律：失败中止、数据不动、状态不推进**。

## 8. 可视化审查：图是审查的输入

**Palantir 做法**：Ontology 以图呈现——对象/链接/属性一眼可见。

**根本办法**：审查前先看图。结构错误（孤立的对象、指向不存在的链接、错误的基数）在图上几秒可见，在 JSON 里可能被忽略。

**为什么**：审查的瓶颈是理解，不是决策。图把"理解成本"降到最低。

**我们**：`paip-visualize` 把 objects/links 渲染为实体关系图（draw.io MCP）。

## 9. 产物校验：格式先于执行

**Palantir 做法**：平台对产物有强 schema 约束，坏产物进不了下一阶段。

**根本办法**：**执行前先校验格式**——规则 type 合法、参数齐全、列存在、源已注册；校验不过，执行不启动。

**为什么**：坏格式规则比没有规则更危险——它会在执行时产生部分结果或静默错误。校验把错误挡在执行之前，且**问题全部列出**（不吞错误）。

**我们**：`bin/validate.js` 校验四类产物（objects/links/transforms/merges），错误格式 `✘ [id] 原因`；exec 启动时内部强制先跑，失败中止、零副作用。

---

## 验证与规模

- 全部引擎行为经实验验证（`experiment/csv-parse-edge-cases`、`transform-rules-semantics`、`merge-semantics`、`scale-benchmark`），细节见各实验 report 与 spec §11
- 规模实测：10 万行 × 7 列 ≈ 310ms / 202MB；100 万行 ≈ 3.25s / 905MB——纯 JS 内存执行在百万行内可行；更大规模触发"外接 DB/自建服务"路径（规则 IR 不变，换后端适配器）
