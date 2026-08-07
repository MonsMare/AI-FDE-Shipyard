---
name: paip-review
description: 审查 staging 中的 Ontology 建议（对象/链接/转换/合并），批准为正式版本，并生成审计日志。当用户说"审查"、"提交"、"批准"、"审计"、"完成流水线"时使用。
---

# paip-review: 审查、提交与审计

## Overview
对应 Palantir 的 **human validation** 环节（"AI-authored proposals are subject to human validation. All action can be audited."）。所有 LLM 生成的建议在进入正式 Ontology（approved/）前，必须由人审查确认。本 skill 驱动审查流程、提交批准项、更新状态机、生成完整审计轨迹。

## When to Use
- staging/ 里有待审建议（objects/links/transforms/merges）
- 用户说"审查"、"批准"、"提交"、"跑一遍审计"
- 用户说"完成流水线"（走完最后一步）

**When NOT to use:**
- staging 为空 → 说明还没有待审内容，提示先跑 source/infer/model/entity
- 用户只是问状态 → 用 `node <插件根>/bin/audit.js state <项目目录>` 查看，不需要本 skill

## Steps

### 1. 汇总待审内容
- 读取 `staging/objects.json`、`links.json`、`transforms.json`、`merges.json`
- 列出全部待审项，按类别分组，每项给出建议摘要（id/displayName/一句话）

### 2. 逐类呈现给用户（一次性呈现代价最小）
呈现格式（逐项，用户可逐项回"批准/拒绝/修改"）：
```
对象类型（5 项）:
1. Customer — 购买产品的个人或组织 [批准/拒绝/修改]
2. Order — 客户订单 [批准/拒绝/修改]
链接（2 项）: ...
转换（3 项）: ...
合并（1 项）: ...
```
- 用户逐项裁决；"修改"= 用户给出修正，按用户意见改后重新呈现在该轮审查中
- 默认一次性呈现全部，避免多轮往返

### 3. 写入 approved/
批准项移入 `approved/`（`status: "approved"`、`approvedAt`、`approvedBy: "user"`），拒绝项写回 staging 标记 `status: "rejected"`（**保留记录，不删除**——审计需要），修改项按用户意见更新后批准。

### 4. 更新状态与审计
- `state.json`：对象/链接/转换/合并的状态迁移，`stats.*Approved` 累加；审查轮次完成，`currentStep` 推进到 `review` 完成（`review` 完成即进入 `exec`——已批准规则可执行物化）
- 审计（逐条记录）：
```
node <插件根>/bin/audit.js log <项目目录> review object_approved Customer "用户批准"
node <插件根>/bin/audit.js log <项目目录> review transform_rejected normalize_email "用户拒绝"
```
- 走完最后一步后，`state.json` 的 `steps.review` 置为 `done`，审查闭环（执行由 `paip:paip-exec` 承接）

### 5. 审查报告
- 批准/拒绝/修改统计表
- `approved/` 产出的完整清单
- 审计轨迹路径（`audit/audit.jsonl`），提示用户可复查
- 后续选项：**批准后执行**（`paip:paip-exec`——approved 规则跑 `node <插件根>/bin/exec.js <项目目录>` 物化 output/）、新一轮迭代（回到 source 注册更多源，再 infer）或项目收尾

## Boundaries
- 批准是**用户**的决定——本 skill 不替用户做判断，只组织呈现
- 拒绝项保留在 staging（status=rejected），不删除
- 已批准的项**不改**（如需变更 → 新的 staging 建议，走新审查轮）
- 不执行转换/合并本身（那是下游执行，本 skill 只做版本与审计）

## Resilience
- 用户只批准一部分：未批准项留在 staging，下次 paip-review 继续
- staging 文件损坏：报错并停止，不丢已批准项
- 审查中途中断：已写入 approved 的保持，未审的留在 staging，重跑即续

## Common Mistakes
- 替用户批量批准（必须逐项呈现代价后由用户裁决）
- 拒绝后删除记录（审计需要保留 rejected 痕迹）
- 未更新 state.json 的 stats（审查记录会失真）
- 把 approved/ 当 staging 继续写（approved 是不可变版本）
