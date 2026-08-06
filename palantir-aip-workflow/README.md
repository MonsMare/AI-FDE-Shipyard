# Palantir AIP Workflow (paip) — ADE 插件

把 Palantir AIP 风格的 Ontology 构建流水线包装为 **Claude Code 插件**（skill 套件 + 确定性内核工具）。用户在 ADE（Claude Code）内直接调用各 skill，完成整套 Ontology 搭建。

## 背景

源自对 Palantir AIP 的深度调研（见 `palantir-like-workflow/README.md`）。核心发现：
- Palantir 把 Ontology 构建改造成 **"数据源联邦 + LLM 生成转换逻辑 + 向导自动收尾"** 流水线
- 私域化部署（自托管模型、本地、air-gapped）是明文产品能力
- "逻辑作为确定性工具、不进 prompt"、"AI 出提案人审查"、"动作可审计" 是三条铁律

本插件把这套策略做成可直接在 ADE 中执行的流水线。

## 流水线

```
paip-init → paip-source → paip-infer → paip-model → paip-entity → paip-visualize → paip-review
```

| Skill | 职责 | 对应 Palantir |
|---|---|---|
| `paip-init` | 初始化 Ontology 项目骨架 | — |
| `paip-source` | 联邦注册数据源 + schema 推断 | Ontology Hydration / Pipeline Builder |
| `paip-infer` | LLM 推断对象类型/属性/链接 | Ontology 语义建模（OAG 接地） |
| `paip-model` | LLM 生成确定性转换规则 | Pipeline Builder Generate |
| `paip-entity` | LLM 跨源实体消解（≥0.9 置信度） | Entity Resolution |
| `paip-visualize` | 渲染实体关系图（draw.io MCP） | Object Explorer / 语义图 |
| `paip-review` | 人工审查 → approved + 审计日志 | Human validation / audit |

## 三条铁律（流水线纪律）

1. **AI 出提案，人做审查**：LLM 产物只进 `staging/`，必须经 `paip-review` 人工裁决才进 `approved/`
2. **逻辑是确定性工具**：转换/合并是规则（正则/映射/join），不是 LLM 判断——可审计、可重放、不随模型漂移
3. **全量审计**：每个动作写 `audit/audit.jsonl`，拒绝项也保留（`status: "rejected"`），杜绝删改

## 项目结构

```
<ontology-project>/
├── config.json        # 项目配置 + 状态机
├── state.json         # 流水线状态（步骤/已注册源/统计）
├── sources/           # 数据源注册（联邦引用，不复制数据）
├── schemas/           # schema 推断结果
├── staging/           # 待审查的 LLM 建议
├── approved/          # 已批准的正式版本（不可变）
├── audit/audit.jsonl  # 审计轨迹
└── data/              # （可选）演示数据
```

文件格式规范见 `templates/ontology-project/README.md`。

## 安装

### 本地开发安装（推荐）
```
# 把本目录作为本地插件目录：
# ~/.claude/plugins/marketplaces/<你的市场名>/palantir-aip-workflow
# 然后：/plugin marketplace add <marketplace名> → /plugin install palantir-aip-workflow
# 或直接把 skills/ 复制到项目级 .claude/skills/
```

### 项目级安装（最简）
把 `skills/` 下六个目录复制到项目的 `.claude/skills/`，插件即刻可用。

### 发布为插件
保留 `.claude-plugin/plugin.json`，放入插件市场目录（git 仓库），用户即可 `/plugin install`。

## 内核工具（bin/）

| 工具 | 用途 |
|---|---|
| `bin/schema-infer.js` | 确定性 schema 推断（CSV/JSON/JSONL → 列类型/样本/空值率/去重） |
| `bin/audit.js` | 状态机校验 + 审计事件追加（log/state/step/check） |

零依赖，Node 18+，直接 `node bin/<tool>.js` 调用。

## LLM 通道

- **默认**：宿主 agent 的 LLM（Claude Code 内直接生成）
- **可选**：`config.json` 的 `llm` 段配置批量通道（deepseek/bailian 等 anthropic 兼容端点），供需要确定性批量推理的场景

## 验证

`node bin/audit.js check <项目目录>` 校验项目完整性；`scripts/` 下有端到端演示脚本（示例数据集走完六步）。
