---
name: paip-exec
description: 执行已批准的数据转换与实体合并（Palantir Pipeline Builder 的物化环节：规则真的跑在数据上，产出物化 CSV 与审计事件）。当用户说"执行转换"、"跑流水线"、"materialize"、"生成 output 产物"、"执行已批准的规则"时使用。
---

# paip-exec: 确定性执行引擎

## Overview
对应 Palantir 流水线的**物化环节**："声明不产生价值，物化才产生"。所有已批准（approved/）的转换与合并规则由确定性执行引擎 `bin/exec.js` 真实跑在数据上，产出 `output/<规则id>.csv` 物化产物与审计事件。

**硬约束**：执行的唯一路径是 `node <插件根>/bin/exec.js`。本 skill **禁止**重新实现任何转换/合并逻辑（防第二真相源）——LLM 只负责调用引擎与解读结果。

## When to Use
- approved/ 里有已批准的转换/合并规则，用户说"执行"、"跑流水线"、"生成产物"
- paip-review 批准完成后自然衔接（"批准后执行"）
- 用户问"规则真的生效了吗"（跑一次 exec 展示物化结果）

**When NOT to use:**
- 规则还在 staging/ 未批准 → 先 paip-review
- 用户要生成新规则 → `paip:paip-model`
- 用户要建模/消解 → `paip:paip-infer` / `paip:paip-entity`

## Steps

### 1. 确认已批准产物
- 读 `approved/transforms.json`、`approved/merges.json`
- 为空 → 报告"无事可做"，提示先走 model/entity + review

### 2. 执行引擎
```
node <插件根>/bin/exec.js <项目目录>
```
- 引擎内部**强制先跑校验**（bin/validate.js）：规则 type/参数/列存在性/源注册，失败中止、数据不动、状态不推进
- 可选过滤：`node bin/exec.js <项目目录> --transform <id> --merge <id>`（单条执行）

### 3. 展示结果与审计
- 产物清单：`output/<id>.csv`（转换）+ `output/<merge-id>.csv` + `output/<merge-id>-mapping.csv`（合并与映射表）
- 审计事件：`transform_executed`×N / `merge_executed`×M（成功一次性记录）；失败只记一条 `exec_failed`
- 状态机：成功后推进到 `exec`

### 4. 说明产物位置
- 物化 CSV 在 `output/`，不覆盖任何原数据
- mapping 表（右键值 → 左键值）可追溯合并归并
- 提示用户可打开产物抽查，或继续下一轮迭代

## Boundaries
- 只执行 **approved/** 的规则；staging 的一律不碰
- 不修改源数据、不覆盖 `sources/`、`schemas/`
- 失败时**零副作用**：无 output 产物、状态不推进——向用户如实报告错误清单
- 不重新实现规则逻辑（唯一执行路径是 exec.js）

## Resilience
- 校验失败：原样展示全部 `✘` 问题，不改任何文件，建议先修规则（paip-model 重新生成 → review）
- 数据文件缺失：报告缺失来源，不执行
- 部分批准（有转换无合并）：正常执行转换，跳过合并

## Common Mistakes
- 在 skill 内手写转换逻辑绕过 exec.js（第二真相源，规则会漂移）
- 执行失败后继续推进状态机（铁律：失败时状态不动）
- 把 output/ 当数据源再喂回 exec（产物不可回灌，规则应基于 sources/）
