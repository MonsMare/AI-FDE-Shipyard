# paip v2.0 执行引擎实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec/2026-08-05-paip-engineering-design.md 实现 v2.0：让流水线"规则真的跑在数据上"（bin/csv.js + bin/validate.js + bin/exec.js + paip-exec skill + engineering-principles 文档）。

**Architecture:** 三层：skill 层（LLM 指令）→ 引擎层（零依赖 Node 脚本：csv.js 公共 CSV 库 / validate.js 产物校验 / exec.js 确定性执行引擎 / audit.js 审计状态机）→ 数据层（sources/schemas/staging/approved/output/audit）。规则 JSON = 语义 IR，纯 JS 行级实现为基准参考实现。exec 内部强制先跑 validate，失败中止、零副作用。

**Tech Stack:** Node 24.15（零依赖，node:test 做测试），CLI 脚本沿用现有 bin/ 风格（CommonJS、`'use strict'`、`process.exit`）。

## Global Constraints

- 零第三方依赖（项目铁律，测试用内置 `node:test` + `node --test`）
- 规则 type 权威枚举 9 种：`regex_replace / regex_extract / map / filter / concat / split / cast / lower / upper / trim`（spec §3.6，删 format_date）
- 单元格一律为字符串（CSV 语义）；cast 输出规范化字符串、失败置 null（spec §3.6 执行细则，2026-08-06 实验确认）
- filter 的 gt/lt 数值可解析时按数值比较（实验确认）
- 铁律：失败中止，数据不动，状态不推进；统一写盘（内存算完才写）
- 输出命名用规则 id：`output/<id>.csv`；`target` 字段仅描述性
- 审计事件：成功一次性 `transform_executed`×N + `merge_executed`×M；失败一条 `exec_failed`
- merge 声明形态（本次统一，模板 README 与 paip-entity 对齐）：`{id, left:{source,key,value}, right:{source,key,value}, confidence, rationale}`——value 为 LLM 判定的匹配键值对
- 合并语义：键映射表（右键值→左键值）→ 行级主键替换；左表优先；同名列 `_right`；fan-out（值不唯一）中止；右表独有键值行不并入（计 rightOnly）
- 错误格式：`✘ [规则 id] <原因>`，全部列出后退出

---

### Task 1: bin/csv.js — 公共 CSV 库

**Files:**
- Create: `palantir-aip-workflow/bin/csv.js`
- Test: `palantir-aip-workflow/tests/csv.test.js`

**Interfaces:**
- Produces: `parseCsv(text) → {cols: string[], rows: string[][]}`（RFC 4180 状态机：BOM 剥离、`""` 转义、引号内嵌换行、空行保留）；`stringify(cols, rows) → string`（引号包裹、`""` 转义、CRLF 行尾、行序稳定）；`readCsvFile(filePath) → {cols, rows}`；`writeCsvFile(filePath, cols, rows)`
- Consumes: 无

- [ ] **Step 1: 写失败测试** `tests/csv.test.js`（node:test，用例从 `experiment/csv-parse-edge-cases/scripts/run.js` 移植）：
  - BOM 前缀不污染表头；转义引号 `"say ""hi"""` → `say "hi"`；引号内嵌换行保留；空行保留；stringify 往返一致；CRLF
- [ ] **Step 2: 运行确认失败**：`node --test tests/csv.test.js` → FAIL（module not found）
- [ ] **Step 3: 实现** `bin/csv.js`：从 `experiment/csv-parse-edge-cases/scripts/run.js` 的 `parseCsvFixed` + `stringify` 移植，改为 module.exports + 文件读写封装
- [ ] **Step 4: 运行确认通过**：`node --test tests/csv.test.js` → PASS
- [ ] **Step 5: 提交** `git add palantir-aip-workflow/bin/csv.js palantir-aip-workflow/tests/csv.test.js && git commit -m "feat(csv): 公共 CSV 库（RFC 4180 parse/stringify）"`

---

### Task 2: bin/validate.js — 产物格式校验器

**Files:**
- Create: `palantir-aip-workflow/bin/validate.js`
- Test: `palantir-aip-workflow/tests/validate.test.js`

**Interfaces:**
- Consumes: `bin/csv.js`（无直接依赖，但需读 `schemas/*.schema.json` 与 `sources/*.json`）
- Produces: `validateProject(projectDir, {stage}) → {ok: boolean, problems: string[]}`（problems 格式 `✘ [scope/id] 原因`，聚合全部不中断）；CLI：`node bin/validate.js <项目目录> [--stage]`（有问题则 exit 1）；exec.js 将 `require('./validate.js')` 调用 `validateProject`

**校验规则（spec §3.2，对照 experiment/validate-artifacts）：**
- objects：有 id/displayName/properties；properties 有 primaryKey
- links：两端对象存在（approved 用 approved 集；--stage 用 staging 集+approved 基准）；cardinality ∈ {1:1, 1:N, N:M}
- transforms：type ∈ 9 种权威枚举；rule 参数齐全（对照 §3.6 各 type 参数表）；column 存在（对照 schemas/*.schema.json 的列）；source 已注册（对照 sources/*.json 的 id）
- merges：confidence ∈ [0,1]；left/right.source 已注册；left/right.key 是对应 schema 的列
- 文件缺失处理：某规则文件不存在（如无 merges.json）= 跳过该类型（部分批准合法）

- [ ] **Step 1: 写失败测试**：合法产物 → ok:true、0 problems；非法产物（缺主键/链接指向 Ghost/cardinality 1:X/type magic/confidence 1.5/column 不存在/source 未注册）→ ok:false 且全部列出（从 experiment/validate-artifacts 用例 + spec §3.2 扩展）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** bin/validate.js（四类校验函数 + 聚合 + CLI）
- [ ] **Step 4: 运行确认通过**：`node --test tests/validate.test.js`
- [ ] **Step 5: 提交** `git commit -m "feat(validate): 产物格式校验器"`

---

### Task 3: bin/exec.js — 确定性执行引擎（核心）

**Files:**
- Create: `palantir-aip-workflow/bin/exec.js`
- Test: `palantir-aip-workflow/tests/exec.test.js`（L1 规则语义 + L3 破坏性）

**Interfaces:**
- Consumes: `bin/csv.js`（parse/stringify）、`bin/validate.js`（validateProject）、`bin/audit.js`（addEvent 模块接口）
- Produces: `execProject(projectDir, {transforms, merges}) → {ok, outputs: string[], events: object[]}`；CLI：`node bin/exec.js <项目目录> [--transform <id>] [--merge <id>]`
- 流程（spec §4）：读 approved/transforms.json + approved/merges.json → 内部强制 validateProject（失败 exit 1 零副作用）→ 导入数据源 CSV（sources/*.json 的 path 指向实际文件）→ transform（数组顺序=执行顺序，9 规则按 §3.6 执行细则）→ merge（先全部 transform 后 merge）→ 统一写盘 output/<id>.csv → 审计（一次性 transform_executed×N + merge_executed×M；失败 exec_failed）
- 错误处理（spec §5）：approved/ 不存在=中止；无 transforms.json/merges.json=跳过；approved 全空=无事可做成功退出；数据文件不存在=中止；正则非法=validate 捕获或 exec try-catch；写盘失败=中止报告
- 合并实现（value 声明驱动）：mapping = {right.value → left.value}；右表 key===right.value 的行主键替换为 left.value 并入左表；左优先、同名列 `_right`；fan-out 预检（left.value/right.value 在各自表内不唯一→中止）；产物 output/<merge-id>.csv + output/<merge-id>-mapping.csv（格式 `right,left` 两列）

- [ ] **Step 1: 写失败测试** tests/exec.test.js：
  - L1：9 规则语义用例（从 experiment/transform-rules-semantics 移植 17 用例）+ 链式（regex_replace → upper 作用于产物）
  - L1：merge 用例（正常合并/同名列冲突/fan-out/rightOnly，从 experiment/merge-semantics 移植，改 value 声明驱动）
  - L3 破坏性：column 不存在/正则非法 → validate 拒绝、无 output、state 不推进、审计只记 exec_failed；approved/ 不存在 → 中止；部分批准（无 merges.json）→ 正常执行 transforms
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** bin/exec.js（参考实现已由两个实验验证，直接移植）
- [ ] **Step 4: 运行确认通过**：`node --test tests/exec.test.js`
- [ ] **Step 5: 提交** `git commit -m "feat(exec): 确定性执行引擎（9 规则+merge+审计+零副作用）"`

---

### Task 4: audit.js 扩展 + schema-infer.js 改造

**Files:**
- Modify: `palantir-aip-workflow/bin/audit.js`（STEPS 扩 7 步、新增 exec 事件类型与子命令）
- Modify: `palantir-aip-workflow/bin/schema-infer.js`（改用 bin/csv.js）
- Test: `palantir-aip-workflow/tests/audit.test.js`

**Interfaces:**
- Produces: audit.js 模块接口 `addEvent(projectDir, step, action, target, detail) → evt`（供 exec.js require）；STEPS = `['init','source','infer','model','entity','review','exec']`；`node bin/audit.js exec <projectDir> <status>` 子命令（status ∈ executed|failed，记录 transform_executed/merge_executed/exec_failed）
- Consumes: 无

- [ ] **Step 1: 写失败测试**：STEPS 含 exec；addEvent 递增 lastEventId；exec 子命令写事件
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：audit.js 扩 STEPS + 模块导出 addEvent + exec 子命令；schema-infer.js 删除内置 parseCsv、`require('./csv.js')`（保持 CLI 行为不变）
- [ ] **Step 4: 运行确认通过**：`node --test tests/audit.test.js` + `node bin/schema-infer.js` 对带 BOM 的 CSV 冒烟（表头无 BOM 污染）
- [ ] **Step 5: 提交** `git commit -m "feat(audit): 状态机扩 exec 步骤; refactor(schema-infer): 复用 csv.js"`

---

### Task 5: L2 端到端 demo 测试

**Files:**
- Create: `palantir-aip-workflow/tests/e2e.test.js`
- Create: `palantir-aip-workflow/tests/fixtures/demo/`（customers.csv 4 行脏数据 + orders.csv 4 行 + sources/*.json + schemas/*.schema.json + approved/{objects,links,transforms,merges}.json）

**Interfaces:**
- Consumes: execProject / validateProject / audit 全部模块接口
- Produces: 完整流水线验证（spec §6 L2）：output/ 出现按规则 id 命名的物化 CSV；转换真实生效（脏数据变干净、链式）；合并后主键归并 + mapping 表产出；审计事件一次性记录；state.json 推进到 exec

- [ ] **Step 1: 写失败测试** tests/e2e.test.js：fixtures 项目 → validateProject(ok) → execProject → 断言 5 项（物化 CSV 内容、审计事件、state）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：fixtures 数据 + 测试（引擎已实现，本任务只补集成验证）
- [ ] **Step 4: 运行确认通过**：`node --test tests/e2e.test.js`
- [ ] **Step 5: 提交** `git commit -m "test(e2e): 端到端流水线 demo 验证"`

---

### Task 6: paip-exec skill + 既有 skill 同步 + plugin.json

**Files:**
- Create: `palantir-aip-workflow/skills/paip-exec/SKILL.md`
- Modify: `palantir-aip-workflow/skills/paip-model/SKILL.md`（type 枚举收敛 9 种 + §3.6 表）、`palantir-aip-workflow/skills/paip-review/SKILL.md`（批准后衔接 paip-exec）、`palantir-aip-workflow/skills/paip-entity/SKILL.md`（merge 声明含 value：left/right 各 {source,key,value}）
- Modify: `palantir-aip-workflow/.claude-plugin/plugin.json`（注册 paip-exec，8 skill）

**Interfaces:**
- Produces: paip-exec SKILL.md（职责单一：读 approved → `node bin/exec.js <项目目录>` → 展示结果与审计 → 说明 output/ 位置；硬约束：禁止在 skill 内重新实现任何转换/合并逻辑）；plugin.json skills 数组 + paip-exec 条目（description 触发词："执行转换"、"跑流水线"、"materialize"）

- [ ] **Step 1: 写 paip-exec/SKILL.md**（参考现有 skill 格式：frontmatter + Overview/When to Use/Steps/Boundaries/Resilience/Common Mistakes）
- [ ] **Step 2: 修改 3 个既有 SKILL.md**（type 枚举、review 衔接、merge value 字段）
- [ ] **Step 3: 修改 plugin.json**（+paip-exec 条目）
- [ ] **Step 4: 验证**：`node -e "JSON.parse(...)"` 不可用 → 用 `node --check` 不适用（JSON）；用 `git diff --check` 无尾随空白 + `node --test` 全量回归；人工核对 plugin.json JSON 合法（或 `node -p "require('./.claude-plugin/plugin.json').skills.length"` 在 delivery 模式不可用——改用 `node --test` 或 read_file 人工核对）
- [ ] **Step 5: 提交** `git commit -m "feat(skills): paip-exec skill + 同步既有 skill 与插件注册"`

---

### Task 7: engineering-principles.md + README/模板同步

**Files:**
- Create: `palantir-aip-workflow/docs/engineering-principles.md`
- Modify: `palantir-aip-workflow/README.md`（流水线更新：8 skill + 执行引擎一节 + 命令示例）、`palantir-aip-workflow/templates/ontology-project/README.md`（状态机 7 步、merges 声明含 value、target 描述性、output/ 目录）

**Interfaces:**
- Produces: engineering-principles.md（spec §7 九环节表为骨架，每环节配"为什么"展开段 + 对应 skill/工具映射）；模板 README 与 spec 完全一致

- [ ] **Step 1: 写 engineering-principles.md**（九环节：联邦接入/schema 推断/逻辑确定性化/两段式提交/全量审计/实体消解/执行引擎/可视化审查/产物校验，每环节：Palantir 做法→根本性工程办法→为什么→我们对应）
- [ ] **Step 2: 修改 README.md 与模板 README.md**
- [ ] **Step 3: 验证**：`git diff --check`；人工核对模板 README 的 merge 示例与 paip-entity 一致
- [ ] **Step 4: 提交** `git commit -m "docs: engineering-principles + README/模板同步 v2.0"`

---

### Task 8: 全量验证与交付

- [ ] **Step 1: 全量测试**：`node --test palantir-aip-workflow/tests/` → 全绿
- [ ] **Step 2: 验收标准对照 spec §1**：`node bin/validate.js <项目>` 通过已批准产物校验；`node bin/exec.js <项目>` 产生正确物化 CSV + 审计事件；非法规则被拒且零副作用；docs/engineering-principles.md 九环节表完整
- [ ] **Step 3: 语法检查**：`node --check` 全部 bin/*.js
- [ ] **Step 4: 提交推送** `git add -A && git commit -m "feat: paip v2.0 执行引擎落地" && git push`
