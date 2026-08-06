---
name: paip-init
description: 初始化一个新的 Ontology 项目——创建项目目录、config.json、state.json、子目录骨架并登记审计事件。当用户说"开始搭建 Ontology"、"新建本体项目"、"paip init"、或要在一个新目录里启用 paip 流水线时使用。
---

# paip-init: 初始化 Ontology 项目

## Overview
把 Palantir AIP 风格的 Ontology 构建流水线落地到一个新项目目录。创建"文件即数据库"的项目骨架（config + state + 子目录），为后续 source → infer → model → entity → review 五步流水线建立起点。

## When to Use
- 用户要求开始一套新的 Ontology 构建
- 用户给出新目录路径，要求在其中搭建流水线
- 恢复一个丢失了 config/state 的旧项目

**When NOT to use:**
- 已有项目目录且 config/state 完整 → 直接进入 `paip:paip-source`
- 用户只想要一次性的 schema 分析 → 用 `paip:paip-source`（不建项目）
- 修改已有项目的配置 → 说明不适用，让用户直接编辑 config.json

## Steps

### 1. 确定项目目录
- 用户未指定时，询问或在当前目录下创建 `<name>-ontology/`
- 目录若已存在且非空，先检查是否已有 config.json：
  - 有 → 告知这是既有项目，走 `paip:paip-source` 继续
  - 无 → 说明将初始化，继续（不要覆盖任何既有文件）

### 2. 复制模板骨架
从插件根 `templates/ontology-project/` 复制：
- `config.json`（含 `"<占位>"` 值 → 用实际项目名/描述替换）
- `state.json`
- `README.md`（文件规范说明，保留）
- 创建子目录：`sources/ schemas/ staging/ approved/ audit/ data/`

### 3. 填项目元信息
- `config.project.name`：项目名
- `config.project.description`：一句话
- `config.project.created`：今天 ISO 日期

### 4. 登记审计事件
运行内核审计器：
```
node <插件根>/bin/audit.js step <项目目录> source
```
（若用户只想初始化不立即开流水线，可跳过 step 推进，仅记录 `project_initialized` 事件）

### 5. 报告
输出：项目路径、目录结构、下一步（注册数据源 → `paip:paip-source`）。

## Boundaries
- 只创建/修改 config.json、state.json 与目录骨架
- **不**注册数据源（那是 paip-source 的事）
- **不**做任何 schema 分析或 LLM 调用
- 绝不删除或覆盖用户已有文件

## Resilience
- 目录已存在：不要重建，只补齐缺失的 config/state/子目录
- 模板缺失：手动创建最小 config.json + state.json（结构见 templates/ontology-project/README.md）
- 中途失败：留下已建文件，重新运行即可（幂等）

## Common Mistakes
- 把数据源文件直接复制进项目（应该联邦引用路径，不复制数据）
- 在初始化阶段就调用 LLM 建模（过早；先注册源、推断 schema）
- 覆盖了已有 config.json 的用户自定义字段（合并而非覆盖）
