# paip 能力测试报告（demo-data 实战）

- 日期：2026-08-07
- 方法：用 `demo-data/company-group`（Meridian 控股集团 64 表数据集）对 paip 全部 8 个 skill 与 5 个引擎工具做实际能力测试：静态接口审查 + 全量引擎实测 + 异常注入 + 端到端演练
- 目的：找出 paip 的不足与设计不到位之处，作为**下一周期迭代的目标和依据**

---

## 一、实测通过项（能力基线）

| 能力 | 验证结果 |
|---|---|
| 全量 validate（64 表 + 16 转换 + 20 合并） | ✔ 0 问题 |
| 全量 exec（56 物化产物 + 36 审计事件 + 状态推进 exec） | ✔ |
| 幂等性（连续两次 exec） | ✔ output 稳定 56 个 |
| 异常注入（非法 column） | ✔ 拒绝、output 不变、错误信息清晰 |
| 链式日期清洗（5992 条脏日期 → 0 残留） | ✔ 完全生效 |
| 跨源合并（mapping 表 + 主键归并 + 行数） | ✔ 内容正确 |
| audit check（demo-data 项目） | ✔ 状态机一致 |

---

## 二、发现的问题（按严重度排序）

### 🔴 高严重度（功能缺陷 / 行为违背接口语义）

**P1. 模板 state/config.json 缺 `exec` 步骤（未随 v2.0 同步）**
- 现象：`templates/ontology-project/{state,config}.json` 的 steps 仍为 6 步；paip-init 复制模板后，`audit.js check` 报 `✘ state.json 缺步骤 exec`（EXIT=1）【实测确认】
- 根因：v2.0 将状态机扩为 7 步（review→exec），但模板未更新
- 影响：所有 paip-init 新建项目 check 必失败；状态机一致性校验形同虚设

**P2. exec 的 `--transform` / `--merge` 过滤参数语义错误**
- 现象：`node bin/exec.js <项目> --transform email_lower_retail` 仍执行了全部 20 个合并（审计增量 20 条 merge_executed）【实测确认】
- 根因：`execProject` 中 transform 与 merge 各自独立过滤，`--transform` 不联动过滤 merge
- 影响：用户"只要这个转换"的预期被破坏；部分执行场景会意外合并数据

**P3. `validate --stage` 在流水线早期完全不可用**
- 现象：无 `approved/` 目录时（init→entity 阶段），`validate --stage` 直接报 `✘ approved/ 目录不存在` 退出【实测确认】
- 根因：`validateProject` 对 approved/ 存在性的检查先于一切，未区分 stage 模式
- 影响：staging 校验防线（spec §3.2 设计意图）在流水线前半段无法使用；且**没有任何 skill 提及 `--stage`**（paip-model/entity/infer 的"校验"全靠 LLM 自查）

### 🟡 中严重度（设计不到位 / 数据与规则不自洽）

**P4. demo-data 金额脏格式与清洗规则不匹配（演示"洗不干净"）**
- 现象：`moneyFmt` 生成第三种格式 `58 135`（空格千分位，无 $ 无逗号），`money_strip_symbols` 规则只去 `[$,]` → 1,565 行 cast 后为空【实测确认】
- 根因：生成器的脏格式集与 rules.js 清洗规则集没有对齐；且 `1 234,50`（逗号小数）格式即使被 `[$,]` 处理也会被破坏
- 影响：作为"完整演示资产"出现清洗失败，降低可信度；规则设计缺乏"清洗效果闭环"（exec 后应统计残留脏值）

**P5. schema-infer 对脏日期/金额推断为 `mixed` 且无上下文**
- 现象：三格式日期列 → `mixed`（非 date），三格式金额列 → `mixed`【实测确认】
- 根因：`typeOf` 只认 ISO 日期/纯数字；mixed 只给类型名不给样本分布
- 影响：paip-infer 的 LLM 看不到"这列其实是日期/金额，只是格式脏"——语义建模输入信息不足；建议 mixed 时附带各类型占比与样本

**P6. paip-model 提示模板 `target` 字段自相矛盾**
- `"target": "<输出文件或 same>"` 暗示 target 控制输出，而下方说明"target 仅描述性（不控制输出路径）"——LLM 会生成误导性 target，validate 不检查它（无强制约束）

**P7. paip-review "review 是终态" 的说法过时**
- Step 4 称"`review` 是终态"、Step 5 说"流水线闭环"——v2.0 已加 exec 步骤；状态机描述与 skill 指令矛盾（虽然终态报告已衔接 paip-exec）

**P8. paip-infer 要求 `titleKey` 但校验器/模板不支持**
- skill 提示"标主键 primaryKey 与标题键 titleKey"；validate 只检查 primaryKey，模板 README 属性示例无 titleKey——LLM 可能生成无消费方的字段

### 🟢 低严重度（模糊点 / 知识缺口）

**P9. paip-source 未明确源 id 是否含扩展名**
- `sources/<name>.json` 的 `id` 与 `schemas/<name>.schema.json` 文件名、transforms 的 `source` 字段三者的命名契约未写明（demo-data 用 `xxx.csv`，validate 按 id 精确匹配）——LLM 注册或引用时容易写不一致被 validate 拒绝

**P10. skill 层缺少"日期清洗标准做法"知识**
- cast date 只校验 `YYYY-MM-DD` 前缀（`MM/DD/YYYY` 会被置空）——正确做法是先 regex_replace 转 ISO 再 cast（demo 规则已示范），但没有任何 skill 记录这个模式；LLM 生成日期规则时容易踩坑

**P11. paip-entity 的 join 键候选来源未明确**
- Step 1 说"读 schemas/ 找候选 join 键"，但未要求读 `sources/*.json` 的注册 id（merges 的 left/right.source 必须等于注册 id）

**P12. paip-visualize 依赖硬编码 MCP 工具名**
- `mcp__drawio__open_drawio_mermaid` 等工具名硬编码；虽然声明了兜底（文字表格），但无 drawio MCP 时体验降级明显且无替代可视化（如输出 mermaid 文本文件）

**P13. state.json 的 `sources` 数组与 `sources/*.json` 文件双轨制**
- paip-source skill 要求"`state.json` 的 `sources` 追加注册信息"，但 demo-data 生成器与 exec/validate 均只消费 `sources/*.json` 文件——`state.sources` 在 demo-data 项目中为空数组，两处记录无法保持一致（谁写、谁读、谁权威未定义）【实测发现：demo-data 的 state.sources=[] 而 sources/ 有 64 个文件】
- 附带问题：全量 exec 会推进 `state.json` 的 `lastEventId`/`currentStep`，入库的 company-group 应保持"干净输入态"（review/0），实测脚本应在副本上运行（已修正 capability.js 改为副本执行）

**P14. 日期清洗规则曾存在"值被篡改"缺陷（已修复）+ 产物缺少值校验**
- 现象：`date_dmy_to_iso` 规则 `replacement: "$3-$1-$2"` 把 `DD-MM-YYYY`（如 `05-08-2026` = 8 月 5 日）转成 `2026-05-08`（5 月 8 日）——**月日颠倒**。格式上"清洗完成"（无残留脏格式），但值语义被静默篡改——比格式脏更严重【代码审查发现，2026-08-07 review 复核】
- 根因：规则作者想当然地按"月-日"顺序写替换组，未做值重放验证
- 影响与启示：**exec 产物只有"格式校验"没有"值校验"**——之前的"日期清洗完全生效"结论只验证了格式残留为 0，验证不了值正确性
- 修复：replacement 改为 `$3-$2-$1`；`tests/demo-data.test.js` 新增"日期值重放校验"用例（原始值按规则语义手动转换，与产物逐行比对）【已修复，随本报告提交】

---

## 三、下一周期迭代目标（按优先级）

### 第一优先（修复功能缺陷）
1. **同步模板**：`templates/ontology-project/{state,config}.json` 补 `exec` 步骤（7 步）
2. **修复 exec 过滤语义**：`--transform <id>` 应只执行指定转换（同时仅执行其依赖链）；`--merge <id>` 同理；文档注明组合用法
3. **修复 validate --stage**：无 approved/ 时允许纯 staging 校验（对象存在性检查降级为 staging 集内自查）；并在 paip-model/entity/infer 三个 skill 中接入 `validate --stage` 校验步骤

### 第二优先（设计完善）
4. **demo-data 规则闭环**：对齐生成器脏格式与清洗规则（覆盖空格千分位、避免逗号小数陷阱）；生成器附"清洗效果自检"（exec 后残留统计，纳入 demo-data 测试）
5. **schema-infer mixed 增强**：mixed 时输出各候选类型占比与样本，日期/金额变体识别（MM/DD/YYYY 等标注为 date/currency 候选）
6. **统一 skill 状态机口径**：paip-review 终态改为 exec；paip-model target 描述改"仅描述性"；paip-infer titleKey 移除或 validate 支持

### 第三优先（体验与知识）
7. **命名契约文档化**：paip-source 写明"id 含扩展名 = 文件名 = transforms.source 引用"三段一致契约
8. **skill 知识补充**：日期清洗标准模式（regex 转 ISO → cast 链式）、sources 注册读取、可视化降级路径

---

## 四、验证环境

- Node 24.15.0（win32），零依赖
- 数据集：demo-data/company-group（全量，固定种子 20260806）
- 复现：`node demo-data/verify/capability.js demo-data/company-group`（幂等/注入/schema/清洗四项实测）；`node bin/exec.js demo-data/company-group --transform <id>`（P2）；`node bin/audit.js check <模板初始化项目>`（P1）
