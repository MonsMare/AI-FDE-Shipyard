# paip 流水线重构设计 Spec

- 日期：2026-08-05（修订 v2：经细节完整性审查 15 条 + 合理性审查 5 项 + 3 个可行性实验后修订；2026-08-06 增补 4 个设计可行性实验，见 §11）
- 主题：提炼 Palantir AIP 各环节根本性工程办法 → Skill 化改造 + 确定性执行引擎
- 关联：`palantir-like-workflow/` 调研报告、`palantir-aip-workflow/` 现有插件

---

## 1. 背景与目标

### 问题
当前 `palantir-aip-workflow` 插件（7 个 skill）复刻了 Palantir 构建流程的**形状**（注册→推断→建模→审查→审计），但：
- 数据规模小（纯 Node 内存处理 CSV）
- **转换/合并是纸面规则**（staging/approved 里的 JSON 声明，无人执行）
- 没有"规则真的跑在数据上"的执行引擎——流水线是死的

### 用户需求
1. 精准提炼 Palantir 整套流水线**各环节的根本性工程办法**
2. 按 **Skill 化方式**改造（环节 = skill 指令 + 确定性工具）
3. 校验器/引擎用**脚本**；规模大的环节**外接数据库或自建服务**（接口留好，后端可换）

### 成功标准
1. `node bin/validate.js <项目>` 通过已批准产物校验
2. `node bin/exec.js <项目>` 产生正确的物化 CSV + 审计事件
3. 非法规则被拒且零副作用
4. `docs/engineering-principles.md` 九环节表完整可读

### 环境事实（已探测）
- Node 24.15（内置 node:sqlite 可用，但见 §2 架构决策——不用 SQLite 做行级变换）
- 无本地 DB 服务（5432/3306/6379 全关）、venv 无 duckdb/pandas
- 现有工具全 Node 零依赖（`bin/schema-infer.js`、`bin/audit.js`）

---

## 2. 总体架构

三层：

```
┌─ Skill 层（指令）─────────────────────────────┐
│  paip-init/source/infer/model/entity/        │
│  visualize/review/exec（8 个 skill）          │
├─ 引擎层（脚本）───────────────────────────────┤
│  bin/exec.js     确定性执行引擎（纯 JS 行级）  │
│  bin/validate.js 产物格式校验器               │
│  bin/csv.js      公共 CSV 解析+序列化（共享）  │
│  bin/schema-infer.js  schema 推断（已有）      │
│  bin/audit.js    审计与状态机（已有）          │
├─ 数据层（文件）───────────────────────────────┤
│  sources/ schemas/ staging/ approved/        │
│  output/（新增：物化产物） audit/             │
└──────────────────────────────────────────────┘
```

### 架构决策（v2 核心变更）：纯 JS 行级执行器，不用 SQLite

**依据（合理性审查 A/D + 实验 `regex-in-sqlite`）**：
- 规则全集（regex_replace/map/filter/concat/cast/lower/upper/trim/split…）**全部是单行内、无跨行状态的行级变换**——SQL 表达是硬凑
- SQLite 内置 `REPLACE()` 不认正则（实验证实，静默错误比报错危险）；自定义函数要每行 JS 桥接，性能与"SQL 快"直觉相反
- 审计重放的对象是**规则 id**（JSON），不是运行时生成的 SQL——SQL 是纯消耗
- node:sqlite 内存库不突破规模上限（双份驻留 + 全量导入），真正突破要文件库+流式+索引，属未来升级

**解耦原则（修正）**：规则 JSON = **语义 IR**；纯 JS 实现为**基准参考实现**（语义锚）。未来接 DB/自建服务 = 新增后端适配器针对 IR 编译，JS 参考实现作差分测试基准。换后端时正则/方言语义可能变化——这是显式代价，不是隐含承诺。

---

## 3. 组件设计

### 3.1 `bin/exec.js`（新增，核心）
确定性执行引擎。读 `approved/transforms.json` + `approved/merges.json` → 纯 JS 行级执行 → 物化 CSV 到 `output/` → 审计。

接口：`node bin/exec.js <项目目录> [--transform <id>] [--merge <id>]`

三个职责段（解耦，便于换后端）：
1. **导入**：读数据源（CSV/JSON，用 `bin/csv.js`）→ 内存行数组
2. **执行**：转换规则 → 每类规则一个确定性函数 `transformRow(row) → row`；合并规则 → 键映射替换
3. **导出**：全部规则在内存算完 → **统一写盘**到 `output/<规则id>.csv`（不覆盖原数据）

**执行语义（修正）**：
- `transforms` 数组顺序 = 执行顺序（显式声明：规则 N 可依赖规则 N-1 的同源产物）
- transform 与 merge 先后：**先全部 transform，后 merge**（合并作用于已清洗数据）
- 输出命名：**用规则 id**（`output/<id>.csv`）；`target` 字段改为描述性（注明"仅描述，不控制输出路径"）
- 链式：同源多规则，后规则输入 = 前规则输出（内存中行数组依次变换，天然链式）

### 3.2 `bin/validate.js`（新增）
产物格式校验器。校验 `approved/` 与 `staging/` 的 objects/links/transforms/merges 符合规范：
- 对象：有 id/displayName/properties、有主键 primaryKey
- 链接：两端对象存在（在**同一集合内**查：approved 用 approved 集，--stage 用 staging 集+approved 作基准）、cardinality 合法（1:1/1:N/N:M）
- 转换：type 合法（对照 §3.6 权威枚举）、rule 参数齐全（对照 §3.6 各 type 参数）、column 存在（对照 `schemas/*.schema.json`，注明取舍：schema 是推断时点快照）、**source 已注册**（对照 `sources/*.json` 的 id）
- 合并：confidence 0-1、left/right 指向已注册源

接口：`node bin/validate.js <项目目录> [--stage]`
**集成**：exec.js 启动时内部强制先跑校验（require validate 的模块接口），失败中止——不依赖 skill 记得先调

### 3.3 `bin/csv.js`（新增，公共模块）
从 `bin/schema-infer.js` 抽取并**修复三缺陷**（细节审查 #11）：
- BOM 剥离（UTF-8 BOM 不再污染首个表头）
- 转义引号（`"a""b"` 正确解析）
- 引号内嵌换行正确解析；空行策略明确：**保留**（不再静默丢弃整行）

同时提供 **stringify**（CSV 写入器，细节审查 #12）：引号包裹、`""` 转义、行序稳定。exec 导出用。

### 3.4 `skills/paip-exec/SKILL.md`（新增）
职责单一：执行已批准（approved/）的转换与合并。步骤：读 approved → `node bin/exec.js` → 展示结果与审计 → 说明 output/ 位置。
**硬约束（合理性审查 E）**：执行唯一路径是 exec.js，**禁止在 skill 内重新实现任何转换/合并逻辑**（防第二真相源）。

### 3.5 既有组件修改
- `bin/schema-infer.js`：改用公共 `bin/csv.js`（含 BOM/引号修复）
- `bin/audit.js`：**新增 `exec` 到状态机**（细节审查 #9）——STEPS 扩为七步 review→exec；或声明 exec 在状态机外、state.json 增 `lastExecutedAt` 字段。**决策：扩状态机**（exec 是流水线正式环节，审计可观测）
- `skills/paip-review/SKILL.md`：审查批准后衔接 paip-exec（"批准后执行"）
- `skills/paip-model/SKILL.md`：规则 type 枚举收敛到 §3.6 权威列表
- `skills/paip-entity/SKILL.md`：merge 语义修正为"键映射替换"（见 3.1）
- `.claude-plugin/plugin.json`：注册 paip-exec（8 skill）
- `README.md`：流水线更新 + 执行引擎一节
- `templates/ontology-project/README.md`：产物格式规范同步修正（target 字段语义、merge 形态）

### 3.6 规则参数参考表（新增，审查附带发现 #1 的最严重缺口）
**每类 type 的 rule 参数形状**（validate"参数齐全"的定义）：

| type | rule 参数 | 行为（确定性） |
|---|---|---|
| `regex_replace` | `pattern`, `replacement`, `column` | 正则全局替换（JS RegExp，g 标志） |
| `regex_extract` | `pattern`, `column` | 提取首个匹配组（无组则全匹配） |
| `map` | `mappings`（对象：旧值→新值）, `column` | 精确值映射；未命中保持原值 |
| `filter` | `condition`（`{column, op, value}`，op∈`eq/neq/gt/lt/contains`） | 保留满足条件的行 |
| `concat` | `columns`（数组）, `targetColumn`, `separator` | 列拼接为新列 |
| `split` | `column`, `separator`, `targetColumns` | 拆分为多列 |
| `cast` | `column`, `targetType`（string/integer/number/boolean/date） | 类型转换；失败置 null |
| `lower` / `upper` / `trim` | `column` | 字符串变换 |

**权威枚举（v2 收敛）**：regex_replace / regex_extract / map / filter / concat / split / cast / lower / upper / trim（10 种，删去 format_date——date 格式统一由 cast 处理）。validate 与 paip-model 提示词共用此表。L1 测试覆盖全部 10 种。

**执行细则（2026-08-06 实验 transform-rules-semantics 实测确认，正式实现照此）**：
- 单元格一律为字符串（CSV 语义）；`cast` 输出**规范化字符串**：integer 去前导零（`007`→`7`）、number 去尾零、boolean 归一为 `true`/`false`（接受 `TRUE`/`1`/`FALSE`/`0`）、date 校验 `YYYY-MM-DD` 前缀格式；**转换失败置 null**（写盘为空串）
- `filter` 的 `gt/lt`：两侧可解析为数字时**按数值比较**（否则 `'9'` 会错误地大于 `'18'`），否则字符串序；`eq/neq` 数值可解析时同规则，否则精确字符串；`contains` 为子串匹配
- `regex_extract` 无匹配 → null（不报错）
- `split` 目标列不足时补空串，多余目标列保留空串
- 空值单元格参与变换：concat 按空串拼接、cast 空值 → null、regex 类按空串处理
- `cast date` 仅校验前缀格式，**不校验日历合法性**（`2026-13-99` 会通过）——可接受的取舍

---

## 4. 数据流

```
数据源（CSV/JSON）→ 导入内存行数组（csv.js 解析）
    → 转换规则（数组顺序=执行顺序）: transformRow(row) → row
       regex_replace→JS RegExp 全局替换（实验 regex-in-sqlite 证实 SQL REPLACE 不可行）
    → 合并规则（后于转换）: 键映射表 → 行级主键替换
    → 全部规则在内存算完 → 统一写盘 output/<规则id>.csv
    → 审计事件（成功后一次性记录）
```

- 输入：approved/transforms.json + approved/merges.json
- 处理：纯 JS 行级（无 SQL、无数据库依赖）
- 输出：output/<id>.csv（不覆盖原数据）+ audit 日志
- 校验：exec 内部强制先跑 validate，失败中止、数据不动、状态不推进

### 合并语义（修正，细节审查 #1/#13 + 合理性审查 C）
- merge 是 **pair 级声明**（left/right 各一条记录）→ 执行 = 构建**键映射表**（`右键 → 左键`）→ 行级主键替换
- 产物形态：`output/<merge-id>.csv` = 合并后表（主键已替换为 canonical）+ `output/<merge-id>-mapping.csv` = 主键映射表
- 冲突策略（写死）：**左表（left.source）优先，右表仅补齐缺失字段**
- fan-out 防护：join 前校验键唯一性，不唯一则中止（报错列出重复键，无产物、状态不推进；2026-08-06 实验实测确认）
- 同名列冲突：左侧优先，右列后缀 `_right`
- 合并仅限二元（3+ 源传递链不在本次范围，未来扩展）
- 语义修正：合并作用于**实例数据行**（不是 objects.json 的类型级 schema——概念错位修正）
- **合并补充语义（2026-08-06 实验 merge-semantics 实测确认，正式实现照此）**：
  - 右表独有键行：**不并入合并表**，计入 `rightOnly`（mapping 表 + rightOnly 报告可追溯，数据不静默丢失）
  - 无重叠键：合并表 = 左表原样 + mapping 空 + rightOnly 全量；列头只声明**实际出现值**的右表列（避免空 `_right` 列）
  - 键列冲突：主键一律用左表值（右表键列不并入）

---

## 5. 错误处理

**铁律：失败中止，数据不动，状态不推进。**

| 场景 | 行为 |
|---|---|
| 规则 type 非法 / rule 参数缺失 | validate 报错，exec 中止，列出全部问题后退出 |
| 规则引用的 column 不存在 | validate 报错，中止 |
| 规则引用的 source 未注册 | validate 报错，中止（细节审查 #6） |
| 正则 pattern 非法（编译失败） | exec 内 try-catch `new RegExp()`，中止 |
| approved/ 目录不存在 | 中止（真错误） |
| **某规则文件不存在（如无 merges.json）** | **视为无该类型规则，跳过**（细节审查 #7：部分批准是合法流程） |
| approved/ 全空 | "无事可做"成功退出（非错误） |
| 数据文件不存在 | 中止，报错指明来源 |
| 执行中途出错 | **统一写盘前失败 → 零副作用**（内存算完才写盘，修正 #4）；写盘本身失败 → 中止并报告已写/未写 |
| 合并键不唯一 | 中止（fan-out 防护） |

错误格式：`✘ [规则 id] <原因>`，全部列出后退出，不吞错误。

### 审计写入时机（修正，细节审查 #10）
- 全部规则成功后**一次性**记录：`transform_executed`×N + `merge_executed`×M
- 失败时记录一条 `exec_failed` 事件（含失败规则 id），零规则事件
- 通过 audit.js 新增子命令完成（保证 lastEventId 递增一致）

---

## 6. 测试与验证

### L1 单元验证（覆盖全部 10 种规则 type，对照 §3.6）
微型 CSV 测每类规则，断言输出值。csv.js 的 parse/stringify 各一组用例（含 BOM、转义引号、内嵌换行）。

### L2 端到端 demo
demo 数据（customers.csv + orders.csv，各 4 行）走完整流水线：
`init → source → infer → model → entity → visualize → review → exec`
断言：
- output/ 出现物化 CSV（按规则 id 命名）
- 转换真实生效（脏数据变干净，链式：规则 2 看到规则 1 的产物）
- 合并后主键归并正确 + 映射表产出
- 审计事件 `transform_executed`/`merge_executed` 一次性记录
- state.json 状态机推进到 exec

### L3 破坏性测试
- 非法规则（column 不存在）→ validate 拒绝、无输出、状态不推进
- 未注册 source → validate 拒绝
- 不存在的数据文件 → 中止
- 部分批准（有 transforms 无 merges）→ exec 正常执行 transforms，跳过 merges
- `audit.js check` 完整性仍通过

---

## 7. 工程办法提炼表（核心交付）

输出：`docs/engineering-principles.md`（独立文档）。

| Palantir 环节 | 根本性工程办法 | 为什么 | 我们的 Skill 化对应 |
|---|---|---|---|
| 联邦接入 | data-in-place：引用不复制 | 复制=第二真相源；联邦保留原系统权威 | paip-source |
| Schema 推断 | 确定性前置 | 建模前先知道"有什么"；推断是事实，建模是解释 | schema-infer.js |
| 逻辑确定性化 | 逻辑作为确定性工具不进 prompt | LLM 推理不可审计不可重放；规则可测试可替换 | paip-model（规则 JSON） |
| 两段式提交 | AI 出提案→人裁决→才生效 | 错误结构比没有结构更贵；human-in-the-loop | paip-infer→paip-review |
| 全量审计 | 动作可审计，拒绝也留痕 | 合规与回滚基础；who-did-what-when 不可丢 | audit.js |
| 实体消解 | 置信度阈值宁缺毋滥 | false positive 比 false negative 危险 | paip-entity（≥0.9） |
| 执行引擎 | 规则真的跑在数据上 | 声明不产生价值，物化才产生 | bin/exec.js（纯 JS） |
| 可视化审查 | 图是审查的输入 | 结构错误一眼可见 | paip-visualize |
| 产物校验 | 格式先于执行校验 | 坏格式规则比没有规则更危险 | bin/validate.js |

每环节另配一段"为什么"解释（完整版见 engineering-principles.md）。

---

## 8. 范围与未来

### 本次（v2.0）不做（YAGNI）
| 未做项 | 理由 | 未来路径 |
|---|---|---|
| 数据库连接器（BigQuery/Snowflake） | 超出文件数据源定位 | 规则 JSON 不变，扩展源类型 |
| 权限模型 | 单用户工具不需要 | 多用户时加 |
| SQLite/DuckDB 后端 | 行级变换不需要（审查 A），规模未到 | 未来 JOIN/聚合需求时按 IR 加适配器 |

### 后续阶段（已定义增量，v2.1/v2.2）

#### v2.1 — Evals-lite 评估框架（在 exec 落地后，与 validate 结构最近，工作量最小）
**Palantir 本质**：评测集（人工标注）+ 执行器（跑被测对象）+ 判定器（输出 vs 期望）+ 回归报告。
**等效构建**（关键洞察：我们的规则是确定性的，判定比 Palantir 更简单）：
- `evals/<domain>-case-<id>.json` 评测集：`{input, expected, notes}`（人工标注）
- `bin/eval.js` 执行器+判定器+回归报告：
  - 确定性域（transforms/merges）：精确对比（无需 LLM 判定，比 Palantir 更严格）
  - LLM 域（infer/entity）：LLM-as-judge（宿主 LLM 按 rubric 打分）
  - 回归报告：对比上次运行，列出回归项
- `skills/paip-eval/SKILL.md`：教 LLM 何时建评测集（改规则/换模型前）、怎么解读回归报告
- 复用：csv.js（样例输入）、validate.js 校验模式、audit.js（评估事件）
- **等效还原**：① 改规则/换模型前有量化依据 ② 回归检测 ③ 评测集累积成机构记忆

#### v2.2 — OAG-lite 接地运行时（v2.1 之后）
**Palantir 本质**（不是 embedding，是"语义模型驱动查询"）：LLM 生成时用 Ontology 的**结构化对象**（而非文档片段）接地——查询命中对象实例的属性/链接/来源，不是向量检索的文本块。
**等效构建**（已有 80% 原材料：objects.json + output/ + 查询脚本）：
- `bin/og.js` 对象查询+上下文组装器：
  - 读 approved/objects.json（语义模型）+ output/*.csv（物化实例）
  - 查询：结构化过滤 + 属性匹配 + 一层链接 join
  - 组装：对象卡片（id/属性/链接/来源引用"来自 output/xxx.csv"）
  - 查询引擎用 **node:sqlite**——此处 SQL 又合理了（跨行过滤/join 是真查询需求，与行级变换不同；审查推翻了 SQLite 在 exec 的位置，但它在 og.js 找到正确位置）
- `skills/paip-query/SKILL.md`：OAG 流程纪律（先查对象再回答、引用来源不臆造、对象不存在时明说）
- **等效还原**：① 结构化语义对象接地（非文档 RAG）② 引用来源不复制数据（data-in-place）③ 对象模型是查询骨架（schema 驱动）
- **深度差异（诚实标注）**：无 embedding 语义检索（结构化过滤+关键词近似）、无对象图遍历（链接限一层 join）、无动作执行

#### 为什么这两项当初被估重（v1 标注为"护城河/需标注数据集"，实际轻一个数量级）
- OAG 护城河核心 = 语义模型 + 查询 + 来源引用；embedding/图遍历是增强不是核心
- Evals 在确定性规则域比 Palantir 更简单（精确匹配不需要 LLM 判定器）
- 两者与 exec/validate 同构：脚本 + skill + 审计，不引入新模式

### 架构预留
规则 JSON = 语义 IR + JS 参考实现（语义锚）；未来接外部 DB/自建服务 = 新增后端适配器编译 IR，JS 基准作差分测试。3+ 源合并、eval 评估、流式导入为后续迭代。

---

## 9. 关键文件清单

新增：
- `docs/engineering-principles.md`（工程办法提炼）
- `bin/exec.js`、`bin/validate.js`、`bin/csv.js`（parse+stringify）
- `skills/paip-exec/SKILL.md`
- `experiment/regex-in-sqlite/`、`experiment/merge-join-sqlite/`、`experiment/validate-artifacts/`（已完成，报告保留）

修改：
- `bin/schema-infer.js`（用公共 csv.js + BOM/引号修复）
- `bin/audit.js`（STEPS 扩到 exec、新增 exec 子命令、exec_failed 事件）
- `skills/paip-review/SKILL.md`、`skills/paip-model/SKILL.md`（type 枚举收敛）、`skills/paip-entity/SKILL.md`（merge 语义）
- `.claude-plugin/plugin.json`、`README.md`、`templates/ontology-project/README.md`

### 后续阶段文件（v2.1 / v2.2，本次不建）
- v2.1：`bin/eval.js`、`skills/paip-eval/SKILL.md`、`evals/` 评测集目录
- v2.2：`bin/og.js`、`skills/paip-query/SKILL.md`

---

## 10. 审查与实验记录（v1→v2 修订依据）

| 来源 | 发现 | 处理 |
|---|---|---|
| 实验 regex-in-sqlite | REPLACE 不认正则（H1 推翻）；自定义函数可行（H2 成立） | §4 改纯 JS RegExp；触发 v2 架构决策 |
| 实验 merge-join-sqlite | JOIN+GROUP BY 合并可行 | 保留为"未来 JOIN 需求"参考 |
| 实验 validate-artifacts | 校验逻辑可直接实现；一条记录可触发多条问题 | §3.2/§5 确认 |
| 合理性 A | 行级变换不需要 SQL | **v2 核心变更**：纯 JS 执行器 |
| 合理性 B | 解耦被高估 | §2 降级为"IR + 基准参考实现" |
| 合理性 C | 合并概念错位（类型 vs 实例）；pair 级应键映射替换 | §3.1/§4 修正 |
| 合理性 D | 百万行是拍脑袋 | §2 记录规模论证 |
| 合理性 E | skill 需禁止自行实现逻辑 | §3.4 硬约束 |
| 细节 #1/#13 | merge 语义冲突、fan-out | §4 合并语义 |
| 细节 #2 | type 枚举三处不一致 | §3.6 权威枚举 |
| 细节 #4/#10 | 回滚不覆盖磁盘、审计时机 | §5 统一写盘+一次性记录 |
| 细节 #5 | 输出命名 id vs target | §3.1 target 改描述性 |
| 细节 #6/#7 | source 解析、部分批准死锁 | §3.2/§5 |
| 细节 #8 | validate 数据来源、exec 集成 | §3.2 内部强制校验 |
| 细节 #9 | exec 不在状态机 | §3.5 扩状态机 |
| 细节 #11/#12 | parseCsv 缺陷、缺写入器 | §3.3 |
| 细节 #14/#15 | SQL 标识符（已随 SQL 移除）、审计完整性 | §5/§8 记录 |

### v2 补充调整（用户追问"OAG/evals 是否有等效替代"后）
- 结论：两者有等效构建路径，且比 v1 预估轻一个数量级
- OAG 核心 = 语义模型 + 查询 + 来源引用（embedding/图遍历是增强不是核心）；我们的 objects.json + output/ + 查询脚本已还原大部分价值
- Evals 在确定性规则域比 Palantir 更简单（精确匹配不需要 LLM 判定器）
- 处理：§8 从"不做"改为"后续阶段 v2.1（evals-lite）/ v2.2（OAG-lite），定义明确的增量"；§9 补对应文件清单

---

## 11. 实验验证记录（2026-08-06，v2.0 设计可行性实测）

对 v2.0 核心设计做了 4 组实验性验证（均在 `palantir-aip-workflow/experiment/`，脚本可复现），全部假设成立，另补 6 处执行细则（已写入 §3.6/§4/§5）：

| 实验 | 验证内容 | 结论 | 对设计的影响 |
|---|---|---|---|
| `csv-parse-edge-cases` | 现有 parseCsv 缺陷（H1a）+ 修复方案（H1b） | 成立：现有实现 5/6 用例错；RFC 4180 状态机修复版 6/6 + 往返 2/2 过 | §3.3 bin/csv.js 方案确认 |
| `transform-rules-semantics` | 10 种规则语义（H2a）+ 链式（H2b）+ 失败零副作用（H2c） | 成立：17/17 规则用例、链式 1/1、破坏性 3/3（无产物、state 不推进） | §3.6 执行细则补充（cast/filter/regex_extract/split/空值/date） |
| `merge-semantics` | 键映射/左优先/fan-out/实例级（H3a-d） | 成立：4/4 用例 | §4 补充 3 条合并语义（rightOnly、无重叠键、键列冲突） |
| `scale-benchmark` | 纯 JS 内存执行规模边界（H4a/H4b） | 成立：100K 行 310ms/202MB；1M 行 3.25s/905MB 不崩溃 | §2 规模论证从"拍脑袋"升级为实测；建议外接 DB 触发线 ≥1M 行或 ≥512MB 峰值 RSS |

**规模实测数据（7 列 × 固定种子，规则=regex_replace+trim+cast）**：

| 行数 | 总耗时 | 峰值 RSS | 解析占比 | 序列化占比 |
|---|---|---|---|---|
| 10K | 36ms | 69MB | 41% | 35% |
| 100K | 310ms | 202MB | 43% | 28% |
| 1M | 3250ms | 905MB | 43% | 29% |

- 执行（行级变换）仅占总耗时 ~19-22%，瓶颈是 CSV 文本往返（解析+序列化）——未来优化方向是流式处理，不是执行器
- 峰值 RSS 近似线性：1M 行 ≈ 905MB；推算 500 万行 ≈ 4.5GB 逼近开发机内存边界

---

## 12. v2.1 迭代记录（2026-08-07，能力测试问题处置）

依据《paip 能力测试报告（demo-data 实战）》（`docs/2026-08-07-paip-capability-test-report.md`，P1-P14）与《paip vs Palantir 对比分析报告》（`docs/2026-08-07-paip-vs-palantir-comparison.md`）完成 v2.1 迭代，处置如下：

### 12.1 P1-P14 处置表

| P 项 | 处置 | 说明（提交） |
|---|---|---|
| P1 模板缺 `exec` 步骤 | ✓ 已修复 | 模板 `state/config.json` 补 `exec` 步骤（状态机 7 步），audit check 对模板初始化项目通过（b8988f2） |
| P2 exec 过滤语义错误 | ✓ 已修复 | `--transform` 时只执行指定转换（跳过全部 merge）；`--merge` 时只执行指定合并（跳过全部 transform）；两者并存各自过滤（085fe1a） |
| P3 `validate --stage` 早期不可用 | ✓ 已修复 | 无 `approved/` 时允许纯 staging 校验（对象存在性检查降级为 staging 集内自查）；paip-model/entity/infer 三个 skill 接入 `validate --stage` 校验步骤（6cc81bc） |
| P4 demo-data 金额清洗不闭环 | ✓ 已修复 | 金额第三格式改美式千分位 `1,234.50`（可被 `[$,]` 规则清洗），重新生成全量 company-group，exec 后 cast 空值残留为 0（0724b71） |
| P5 schema-infer mixed 无上下文 | ✓ 已修复 | mixed 列输出 `typeBreakdown`（各类型占比）与 `dirtyFormats`（MM/DD/YYYY、DD-MM-YYYY 等变体识别）（7068bf3） |
| P6 model `target` 字段自相矛盾 | ✓ 已修复 | 提示模板 target 改"描述性说明（不控制输出路径）"，与 validate 行为一致（95a3a3e） |
| P7 "review 是终态"说法过时 | ✓ 已修复 | paip-review 终态改 `exec`、闭环表述与 7 步状态机一致（95a3a3e） |
| P8 `titleKey` 无消费方 | ✓ 已修复 | validate 新增"属性覆盖 backingSource 全部列"检查（连带 fixtures 补列，6cc81bc）；paip-infer 移除 titleKey 要求，属性仅需 primaryKey（95a3a3e） |
| P9 源 id 命名契约不明 | ✓ 已修复 | paip-source 新增命名契约段：id 含扩展名 ＝ `sources/<id>.json` 文件名 ＝ `schemas/<id>.schema.json` 文件名 ＝ transforms.source / merges.left\|right.source 引用值（95a3a3e） |
| P10 缺日期清洗标准做法 | ✓ 已修复 | paip-model 新增日期/金额清洗标准模式：regex 转 ISO → cast 链式（$n 组顺序保持月日语义）（95a3a3e） |
| P11 entity join 键来源不明 | ✓ 已修复 | paip-entity Step 1 增加"读 `sources/*.json` 确认已注册源 id（left/right.source 必须等于注册 id）"（95a3a3e） |
| P12 visualize 依赖硬编码 MCP 工具名 | 维持现状（推迟） | 无 drawio MCP 时文字表格兜底已声明；替代可视化（mermaid 文本文件输出等）并入 v2.2 |
| P13 `state.sources` 双轨制 | ✓ 已修复 | README 声明 `state.sources` 弃用，权威记录为 `sources/*.json`；生成器与 skill 不再写入（e65a1d8） |
| P14 日期规则月日颠倒 | ✓ 已修复（能力测试阶段） | `date_dmy_to_iso` replacement 改 `$3-$2-$1`（日=$1 月=$2 保持语义）；demo-data.test.js 新增"日期值重放校验"用例（0e479e6，v2.1 计划前完成） |

### 12.2 v2.1 附加交付（超出 P 项范围）

| 项 | 处置 | 说明（提交） |
|---|---|---|
| 规则枚举笔误全量修正 | ✓ 已修复 | 全仓"规则枚举数"笔误统一为 10 种（regex_replace/regex_extract/map/filter/concat/split/cast/lower/upper/trim），plugin.test.js 新增全仓一致性断言（66fabe5） |
| evals-lite 规则效果评估 | ✓ 已落地 | 新增 `bin/eval.js`（单规则前后对照评估），paip-model/paip-review skill 接入；兑现 §8 后续阶段 v2.1（evals-lite）增量定义与 §9 文件清单（dd83613/66b7198） |

### 12.3 推迟至 v2.2+（迭代边界，本次仅文档标注）

- LLM 节点（LLM 函数与动作层深度化）
- OAG-lite 接地运行时
- 动作语义（动作层）
- ER 增强（Entity Resolution 深度集成）
- 引擎适配层（Spark/Flink 可替换执行后端）
- 模型可替换（LLM 供应商抽象）

差距分析与优先级见《paip vs Palantir 对比分析报告》§三（差距根因）/§四（修改建议）；本迭代范围与每任务交付见 `docs/superpowers/plans/2026-08-07-paip-v2.1-iteration.md`。
