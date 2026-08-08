# paip 无法生产级应用的失败根因深度分析
（Palantir 官方资料 + 本地实践证据对照）

- 日期：2026-08-08
- 资料来源：Palantir 官方文档/产品页 9 处（浏览器实抓，2026-08-08）：Pipeline Builder Overview、Ontology Overview、Foundry Entity Resolution 产品页、AIP Now "AIP for Entity Resolution"、Building a Production Pipeline、Define Data Expectations、Use LLM Node、LLM Evaluation Suite、Create a Link Type
- 本地证据：能力测试报告（P1-P14）、可用性审计（A1-A4/B6）、对比分析报告（§三/§四）、paip v2.1 迭代计划
- 问题：我们的流水线交付结果"混乱且无法应用于企业优化"——为什么？

## 一、结论（先行）

**我们的失败不是"做得不够多"，而是"缺了三层 Palantir 视为地基的东西"：**

1. **缺逻辑语义层**——Palantir 在数据集之上建"对象/链接"（Ontology），实体解析产出的是**去重映射**（不动底层数据）；我们物理改写主键 → 交付物自毁关联（A1/A2/A3）。
2. **缺数据质量门禁**——Palantir 的 Data Expectations 在 build 时**自动检查并中止坏构建**（主键唯一/非空等）；我们 validate 不查数据内容 → 主键重复的产物直接交付（A1 实锤）。
3. **缺 AI 工程化**——Palantir 的 LLM 节点有**强类型输出 + 小样本试跑 + 评估套件 + 错误可见**；我们的 LLM 生成规则无强类型、无试跑门禁（v2.1 才补 eval.js 雏形）→ P14 月日颠倒这类"看似成功实则错误"的规则直接进生产。

另外两层次要但同样致命：**ER 用算法全量匹配**（Cleaning→Pairing→Comparison + 人工确认），我们靠 LLM 声明 16 对（覆盖率 8%）；**生产运维**（调度/监控/分支发布）完全缺失。

## 二、Palantir 生产级机制全景（9 处资料归纳）

| # | 机制 | 官方原文要点 | 来源页面 |
|---|---|---|---|
| M1 | **严格输出检查** | "If the expected output checks are not met, builds are prevented to avoid unintentional downstream breaks" | Pipeline Builder Overview |
| M2 | **类型安全函数** | "Functions are strongly typed and can flag errors immediately instead of at build time" | Pipeline Builder Overview |
| M3 | **后端中间层** | "backend writes transform code and performs checks on pipeline integrity…solve schema problems before a pipeline is built" | Pipeline Builder Overview |
| M4 | **逻辑语义层（Ontology）** | "an operational layer…sits on top of the digital assets…connects them to real-world counterparts"；对象/属性/链接 = 映射数据源，**不改写** | Ontology Overview |
| M5 | **ER 全量算法匹配** | "continuous matching of millions of records…hashing methods and AI/ML models…fuzzy matching"；工具链覆盖 fuzzy matching→feature generation→model training→**human validation** | Entity Resolution 产品页 |
| M6 | **ER 三步框架** | Cleaning（标准化）→ Pairing（如 Maximum Jaccardian Distance 建候选对，避免全量两两比较）→ Comparison（如 normalized Indel distance 概率打分）；**Match Confirmation Interface** 人工确认 | AIP for Entity Resolution |
| M7 | **数据期望（Data Expectations）** | 强类型期望（"column is not null"）；**Pre-condition**（输入）/ **Post-condition**（输出 SLA）；失败 = **abort build** 或 warning；主键检查在全量数据集上运行；变更走 PR；结果进 Data Health 监控 | Define Data Expectations |
| M8 | **生产流水线纪律** | 期望先行文档化（刷新率/传播延迟/**正确性保证**）；"build with the idea that you won't be around to maintain it"；分支+发布流程；调度；尽早监控 | Building a Production Pipeline |
| M9 | **LLM 节点工程化** | 预置 prompt 模板；**小样本试跑**（trials over a few rows）；**强类型输出**（Output type 强制）；**错误可见**（Include errors）；**缓存/跳过已处理行**；评估套件（测试数据 + 期望列 + evaluator + 隔离环境） | Use LLM Node / Evaluation Suite |
| M10 | **链接类型（Link Types）** | 外键关系/join 表关系/backing object；**逻辑声明**（外键属性引用主键属性，属性类型匹配自动检测）——**不动数据集** | Create a Link Type |

## 三、失败根因逐条分析（Palantir 做法 vs 我们做法 vs 后果）

### 根因 1：物理改写代替逻辑映射（对应 A1/A2/A3）——最严重

| | Palantir | 我们 |
|---|---|---|
| 实体解析产出 | **去重映射**（ER 记录/链接），底层数据集主键**不变**；对象视图/链接在 Ontology 层表达"同一现实实体" | exec 把右表主键**物理改写**（SC-1→CUST-1）并追加进左表产物 |
| 引用关系 | 外键属性 → 主键属性的**逻辑声明**（link type），与解析结果解耦 | 引用表（subscriptions 等）不联动——物理改键后 **0/2604 引用命中**（A2） |
| 主键唯一性 | post-condition 主键检查 + abort | 合并产物 CUST-1 出现 2 行（16/16 产物）**无人拦截**（A1） |
| 多声明冲突 | ER 有概率打分 + 人工确认界面，冲突显式可见 | SC-1 被两个 merge 声明引用 → **同一实体分裂进两个 canonical**（A3），validate 不查 |

**失败原因**：我们把"实体消解"实现成了**数据变形**（transform 的一种），而 Palantir 把它实现成**语义层产物**（映射/链接），数据管道本身只做规范化。我们的 CSV 产物没有"逻辑视图"载体，于是只能物理改键——这从架构上注定了 A1/A2/A3。
**修复路径（v2.2）**：① merge 产物降级为"左表视图增强 + `*-mapping.csv` 升级为全量键映射表"；② 新增 `resolve-keys.csv` 一等产物（每个被改键值 → canonical 键），供下游 join 改写引用；③ validate 增加"同一 right.value 唯一引用"检查（A3）；④ applyMerge 合并行语义（右表独有列并入匹配行，不追加新行）。

### 根因 2：没有数据质量门禁（对应 A1 交付、P4 残留、B6 信号抹除）

| | Palantir | 我们 |
|---|---|---|
| 检查时点 | **build 时自动运行**（Data Expectations 挂在 transform 输入/输出） | 仅执行前 validate（声明合法性），执行后**无任何检查** |
| 检查内容 | 强类型：非空、主键唯一、值域（全量数据集上跑） | 无数据内容检查（validate 只查 schema/引用/枚举） |
| 失败语义 | **abort build**（防下游污染）或 warning，结果进 Data Health | 失败产物照常写盘交付（audit 只记录"exec_failed"类事件，不拦截坏数据） |
| 变更治理 | 期望定义在代码仓库，改期望走 PR | 无期望概念 |

**失败原因**：我们的 validate 回答的是"规则声明是否合法"，不回答"**产物是否合格**"。Palantir 用"期望"把质量要求**编码进管道**（post-condition 是输出 SLA 的保证）；我们靠人肉 review（LLM 审 LLM），于是主键重复（A1）、清洗残留（P4 的 1565 空值）这类**数据内容级**问题全部漏过。
**修复路径（v2.2）**：① `expectations.json`（每规则可挂 pre/post-condition：非空率、主键唯一、行数守恒、值域、脏格式残留计数）；② validate/exec 执行后自动运行，失败 = 中止 + `✘ [expectation]` 事件；③ **信号保留条款**：qty_abs 类清洗规则必须配 post-condition（如"负数量计数 0 且输出 `-original` 对照产物"），B6 闭环。

### 根因 3：ER 靠 LLM 声明而非算法全量匹配（对应 A4 覆盖率 8%）

| | Palantir | 我们 |
|---|---|---|
| 候选对生成 | **Pairing 算法**（Maximum Jaccardian Distance 等）全量建候选对，**避免全量两两比较** | 无——LLM 读样本凭感觉写声明 |
| 打分 | **Comparison 概率分数**（normalized Indel distance 等） | 无置信度评分体系（声明只有 confidence 字段，无计算依据） |
| 覆盖率 | 百万级记录连续匹配（可扩展架构） | 194 对重复客户只声明 16 对（**8%**） |
| 人工验证 | **Match Confirmation Interface**（人在回路） | 无确认界面（review 步骤只审 schema 不看配对） |
| 端到端可见性 | "end-to-end visibility into each step" | 无（只能看 final 声明文件） |

**失败原因**：我们把 ER 交给 LLM"拍板"，而 Palantir 用**确定性算法穷举候选 + 概率打分 + 人工确认**，LLM/ML 只做辅助（hash/AI 模型加速、fuzzy 增强）。LLM 声明作为唯一来源注定覆盖率低、且无法规模化。
**修复路径（v2.2）**：① `pairing` 确定性候选对生成（blocking by 归一化键 + 相似度阈值）作为声明输入；② 声明字段加 `score`（算法计算）+ `method`（blocking/similarity/llm）；③ 人工确认产物 `confirmations.json`（review 步骤强制过一遍配对样本）；④ 覆盖率统计进审计事件。

### 根因 4：LLM 环节无强类型、无试跑、无评估（对应 P14 月日颠倒）

| | Palantir | 我们 |
|---|---|---|
| 输出约束 | **强类型输出**（Output type 强制 LLM 输出符合 schema） | 规则 schema 手工校验（validate），LLM 生成时无强类型引导 |
| 试跑 | **小样本试跑**（trials over a few rows，秒级反馈） | v2.1 新增 eval.js（副本执行前后对照）——雏形，无强类型输出 |
| 评估 | **Evaluation suite**（测试数据 + 期望列 + evaluator + 隔离环境） | 无评估套件（demo-data 测试是事后回归，不是规则评估） |
| 错误可见 | **Include errors**（LLM 错误与输出并存） | 无（规则生成失败静默） |
| 增量 | **缓存/跳过已处理行**（成本控制） | 无（全量重跑） |

**失败原因**：P14（date_dmy_to_iso 月日颠倒）正是"LLM 输出无强类型校验 + 无试跑评估"的直接代价——规则看起来合法（类型/字段都对），值语义错了。我们 v2.1 补的 eval.js 方向正确，但 Palantir 把试跑+评估做成**节点内建强制环节**，我们是可选工具。
**修复路径（v2.2）**：① 规则 schema 强类型化（pattern/replacement 的正则合法性、$n 组序与 pattern 组数一致性——validate 静态检查）；② eval.js 升级为**必选门禁**（paip-model 生成规则后必须 eval 通过才进 staging，fail 有 `✘ [eval]` 事件）；③ 评估套件（测试数据 + 期望输出列 + evaluator）作为 demo-data 的正式资产。

### 根因 5：无生产运维层（调度/监控/分支发布）

| | Palantir | 我们 |
|---|---|---|
| 期望先行 | 管道定义与期望文档化（刷新率/传播延迟/**正确性保证**、"guarantee broken 时 abort 还是告警"） | 无期望文档（spec 有设计无运维契约） |
| 发布 | 分支 + PR + 受保护分支（propose/approve change） | review 步骤有审批，但无分支隔离（main 直推） |
| 调度 | schedules 作为控制手段（刷新率 SLA） | 无（CLI 手动单次执行） |
| 监控 | Data Health（期望结果/健康检查/告警触发） | audit.jsonl 仅记录事件，无监控/告警语义 |
| 可维护性 | "build with the idea that you won't be around to maintain it" | 规则/声明文件人肉可读，但无维护文档要求 |

**失败原因**：我们把 paip 做成"研究型流水线"（一次执行出结果），Palantir 的定位是"**运营型系统**"（持续运行、可监控、可演进）。企业优化是持续过程，单次执行产物无法支撑。
**修复路径（v2.3）**：① 期望文档模板（per 项目 `expectations.md`：刷新率/正确性保证/失败策略）；② 调度（cron 包装 exec + 状态快照）；③ 监控（audit 事件 → 指标聚合：失败率/空值率趋势）；④ 分支发布（可选 worktree 隔离）。

### 根因 6：清洗与信号保留的张力（对应 B6）

| | Palantir | 我们 |
|---|---|---|
| 机制 | 清洗（transform）与**检查**（expectations）分离：post-condition 可断言"清洗后某信号仍可解释" | qty_abs 转正负数量，**无残留信号、无检查** |
| 语义 | "prevent bad data propagating" vs "fire an alert without preventing update"——**失败策略显式化** | 无失败策略概念 |

**失败原因**：清洗的目标是规范化，企业优化的目标是发现问题——**两者冲突时 Palantir 用"期望"显式裁决**（保留信号或明确告警），我们直接静默抹除（831 个负数量信号消失）。
**修复路径（v2.2）**：engineering-principles 增加"清洗不得静默抹除业务信号"条款；qty_abs 配 post-condition + 输出对照产物。

## 四、根因归纳：三层架构缺失

```
生产级流水线 = 数据管道 + 语义层 + 质量治理 + AI 工程化 + 运维
                  ↑          ↑          ↑            ↑
Palantir:      Pipeline   Ontology   Expectations   LLM Node/Evals   调度/监控/分支
我们:          bin/exec   (无)       validate(声明级)  paip-model+eval  (无)
                  ✅         ❌          ⚠️ 半成品       ⚠️ 雏形            ❌
```

**一句话**：我们的流水线"会跑"，但**不会保证产出正确**（无质量门禁）、**不会维护关联语义**（无逻辑层）、**不会自我验证**（无强类型/评估）、**不会持续运营**（无调度监控）。Palantir 的每一个机制都在回答"**交付物凭什么可信**"——而这正是企业优化的前提。

## 五、修复路线图（按依赖排序）

| 阶段 | 内容 | 依据 |
|---|---|---|
| v2.2-1 质量门禁 | expectations.json（pre/post-condition + abort 语义）+ validate/exec 集成 + 信号保留条款 | 根因 2/6 |
| v2.2-2 键映射语义 | applyMerge 合并行语义 + 全量键映射表 + A3 声明唯一性校验 | 根因 1 |
| v2.2-3 ER 算法化 | 确定性配对（blocking+相似度）+ score/method 字段 + 人工确认产物 + 覆盖率统计 | 根因 3 |
| v2.2-4 AI 工程化 | 规则强类型 schema + eval 必选门禁 + 评估套件资产化 | 根因 4 |
| v2.3 运维层 | 期望文档模板 + 调度 + 监控指标 + 分支发布 | 根因 5 |

## 六、资料来源

1. https://www.palantir.com/docs/foundry/pipeline-builder/overview/ （Pipeline Builder Overview）
2. https://www.palantir.com/docs/foundry/ontology/ （Ontology Overview）
3. https://www.palantir.com/foundry-entity-resolution/ （Foundry Entity Resolution 产品页）
4. https://aip.palantir.com/workflow/9c328b3d-aa76-47c5-a666-555405dd4611 （AIP for Entity Resolution）
5. https://www.palantir.com/docs/foundry/building-pipelines/building-production-pipeline/ （Building a Production Pipeline）
6. https://www.palantir.com/docs/foundry/maintaining-pipelines/define-data-expectations/ （Define Data Expectations）
7. https://www.palantir.com/docs/foundry/pipeline-builder/pipeline-builder-llm/ （Use LLM Node）
8. https://www.palantir.com/docs/foundry/pipeline-builder/evaluation-suite/ （LLM Evaluation Suite）
9. https://www.palantir.com/docs/foundry/object-link-types/create-link-type/ （Create a Link Type）
