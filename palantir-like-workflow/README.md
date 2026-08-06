# Palantir AIP 流水线工程策略研究报告

> 调查日期：2026-08-05
> 主题：Palantir 的 AIP（Artificial Intelligence Platform）如何实现"AI 原生流水线 + Ontology 自动构建"的工程策略，以及其私域化部署实现方式。
> 所有论断均来自一手资料（SEC 归档、官方文档、官方产品页），详见文末来源清单。

---

## 1. 背景事件：Q2 2026 财报暴雷前的爆发（2026-08-03）

Palantir 于 **2026-08-03 美股盘后**发布 Q2 2026 财报（SEC 8-K），标题自称 "**Crushing Consensus Expectations**"（碾压市场共识），次日股价大幅上涨。

关键数字（源自 SEC 归档新闻稿原文）：

| 指标 | Q2 2026 | 同比 |
|---|---|---|
| 总营收 | $1.935B | +93% |
| 美国商业营收 | $764M | **+149%** |
| 美国政府营收 | $809M | +90% |
| Rule of 40 | **155%** | 行业基准是 40 |
| GAAP EPS（摊薄） | $0.41 | 上年 $0.13 |
| 全年营收指引（上调后） | $8.150–8.158B | +82% |
| 全年美国商业指引（上调后） | >$3.424B | ≥+134% |

**增长叙事（CEO Alex Karp 原文）**："Demand for AI sovereignty has now been unleashed. And Palantir is the only company that has demonstrated it can transform tokens into actual economic value. ... Their competitive advantage should never become the training data for future models."

即：企业/政府发现把数据喂给云厂商 AI = 把竞争优势变成别人训练数据，因此转向"主权 AI"（数据可控、模型可换、部署可私有）。这是 149% 增长的技术根因，也是本报告主题的背景。

---

## 2. AIP 与 Ontology 的关系：叠加，不是替代

**核心结论：AIP 不是"用大模型替代 Ontology 构建"，而是在 Ontology 之上叠加一层生成式 AI——LLM 把 Ontology 既当"语义接地上下文"，又当"可调用动作/工具"。**

架构三层（官方 Foundry AI OS 页）：

```
数据层              语义层（Ontology）            AI 层（AIP）
企业数据库  ──▶  Ontology 数字孪生  ──▶  LLM + Agent + Evals + 人机协同
云/本地数据源     对象/属性/链接/动作         推理/编排/评估/治理
                  ↓ 三种接线方式
      ① Connect AI to Enterprise Data（接地，防幻觉）
      ② Connect AI to Enterprise Logic（业务逻辑→确定性工具，不进 prompt）
      ③ Connect AI to Enterprise Systems of Action（决策写回运营系统，可审计）
```

关键官方表述（SEC 10-K 原文）：
> "It provides unified access to **open-source, self-hosted, and commercially available LLMs** that can transform structured and unstructured data into LLM-understandable objects and can turn organizations' actions and processes into **tools for humans and LLM-driven agents**."

要点：
- **OAG（Ontology-Grounded Generation）** 替代朴素 RAG：LLM 基于语义模型接地而非向量检索，降低幻觉
- **动作层治理**：权限在 agent 读取/推理/执行前强制；审计 prompt、tool call、eval、approval、结果
- **模型可替换**：专有上下文跨模型可移植；换模型前后做质量测量；跨模型族故障切换
- **人机协同**：AI 出提案 → 人工校验 → 写回运营系统 → 结果反馈为机构记忆

---

## 3. 私域化/本地部署：是核心设计目标，不是附属功能

**结论：AIP 客户可私有部署模型，且这是产品级明文能力。** 证据链：

1. **10-K**：AIP "provides unified access to **open-source, self-hosted, and commercially available LLMs**"
2. **自托管文档**（[Self-host models with AIP](https://www.palantir.com/docs/foundry/aip/self-host-models/)）原文：
   > "You can self-host models by backing a registered model with a compute module... run open-source or custom LLMs **on your own infrastructure**... This is useful when you need:
   > - **Data sovereignty**: Keep all inference traffic within your own network boundary.
   > - **On-premise or air-gapped deployments**: Run models without any external connectivity.
   > - Cost control: Use your own GPUs instead of paying per-token.
   > - Early access to new models."
   > 实现方式：容器镜像（vLLM 或 Ollama 推理服务器）→ Artifacts → compute module → 注册模型 → 在任意 AIP 应用中选择使用
3. **Sovereign AI 页**（15 条主权原则）：
   - "Shift to smaller, **private, open, or deterministic paths** when they deliver the same outcome with more control"
   - "Maintain failover across **model families and hosting surfaces**"
   - "Deploy where the mission lives: **Cloud, on-prem, sovereign cloud, disconnected edge, factory floor, field environment**"
4. **Apollo 部署层**（10-K）："continuous delivery of our software wherever our customers are: in the cloud, **on-premises**, or even more rugged environments"——云、本地、air-gapped、边缘硬件均可
5. **Foundry AI OS 页**："**Activate LLMs and other AI on your private network**, subject to full control."

---

## 4. 核心发现：Ontology 构建的自动化加速路径（五层）

> 背景：Ontology 构建曾是劳动与思考密集型工作（顾问驻场 + 领域专家 + 数据工程师手工建摸）。Palantir 将其改造为"数据源联邦 + AI 生成转换逻辑 + 向导自动收尾"的三段式流水线。

### 第 1 层：数据落地即映射（Ontology Hydration——官方称"旗舰能力"）

- 外部数据源（BigQuery、Snowflake、S3、Azure Blob）**联邦直连，不复制数据**："Incorporate existing datasets in external systems into objects — **without duplicating the underlying data**."
- **Pipeline Builder**：只需"定义端点 schema、描述管道意图"，"Pipeline Builder's back end will then **automatically write transform code**"（后端自动生成转换代码）
- 模型也可被"水合"：model connectors 自动绑定模型到 Ontology 对象、Action、Process

### 第 2 层：LLM 生成构建逻辑（Pipeline Builder 的 AIP 能力——最直接答案）

官方文档 [AIP features in Pipeline Builder](https://www.palantir.com/docs/foundry/pipeline-builder/pipeline-builder-aip/)：

- **Generate**（核心）："Create new data transformation logic **given a user prompt**... using metadata to generate logic, **without exposing the underlying data**. AIP transformations are saved into your pipeline logic **like regular data transformations**."——自然语言描述 → 生成转换节点 → 可审计、可复用、与手写节点无差别
- **Use LLM node**："executing LLMs on your data at scale... **no coding required**."——管道内直接插入 LLM 处理节点（清洗/抽取/分类），支持 Palantir 模型 + 客户注册模型（REST API 或 compute module）
- **Text to embeddings**：embedding 表达式，支持自定义注册模型
- **Explain / Suggest names / Transform Assist（正则助手+时间戳格式化） / 自动 proposal 描述**：AI 自动写文档、起名、生成正则
- **Infer a schema for CSV/JSON**：非结构化文件自动推断 schema——无 schema 数据进入 Ontology 的入口

### 第 3 层：引导式向导 + 自动收尾（Ontology Manager）

[Create an object type](https://www.palantir.com/docs/foundry/object-link-types/create-object-type/) 文档：

- 选已有数据源 → **自动填充元数据 + 自动把每列映射为属性**（"It will also **map every column of the backing datasource to a property**"）
- **自动推断**属性 ID、显示名、基础类型（"will be inferred from the name of the column"）
- 一键 **Generate actions**：自动生成标准编辑动作集
- **SuperRepos（Ontology-as-code）**：代码定义对象类型，可走 CI/CD

### 第 4 层：AI 驱动的数据清洗

- **Entity Resolution**（[产品页](https://www.palantir.com/foundry-entity-resolution/)）："Seamlessly **link records with AI** to establish a reliable, de-duplicated data foundation."——跨源实体自动链接去重（Ontology 建模中最脏最累的一环）
- **Semantic Search**（[文档](https://www.palantir.com/docs/foundry/ontology/overview-semantic-search/)）：embedding 向量关联到 Ontology 对象，语义层直接长在 Ontology 上

### 第 5 层：交付模式革命（AIP Bootcamp——替代"人工考察+团队搭建"的组织层）

- 10-K 原文："our use of AIP bootcamps, which allow us to deliver **real workflows on actual customer data in days**"
- 构建工具族（AIP 文档）：**AIP Logic**（无代码 LLM 函数）、**AIP Chatbot Studio**（前身 AIP Agent Studio）、**AIP Evals**（评估框架）
- 人力重心从"手工建模"降级为"校验 AI 建议 + 治理"（human review checkpoints、动作层审计）

### 旧 vs 新路径对照

| 旧路径（人工考察+团队搭建） | 新路径（AIP 加速） |
|---|---|
| 顾问访谈、手工建摸 | Ontology Manager 向导：选数据源→自动映射→自动生成 actions |
| 数据工程师手写 ETL | Pipeline Builder Generate：自然语言→转换节点 |
| 手工清洗/去重 | Use LLM node / Entity Resolution / Text to embeddings |
| 反复沟通 schema | Infer schema + 联邦直连不复制 |
| 驻场数月 | Bootcamp 几天交付 |

---

## 5. 产品命名地图（2026 年 8 月现状）

| 名称 | 定位 | 备注 |
|---|---|---|
| **Foundry** | 底层数据运营平台 | 数据管理、逻辑编写、Ontology、分析、工作流 |
| **Ontology** | 语义+动能层（数字孪生） | 对象/属性/链接 + 动作/函数/动态安全 |
| **AIP → Foundry AI OS** | 生成式 AI 层 | `/platforms/aip/` 已 301 到 `/platforms/foundry/foundry-ai-os/` |
| **Apollo** | 云无关持续交付/配置控制层 | 任意环境部署 |
| **Gotham** | 政府/情报端平台 | 与 Foundry 共享 Ontology |
| **HyperAuto (SDDI)** | SAP 数据集成工具 | AI 仅做输入表建议 |

AIP 构建工具族：**AIP Logic**（无代码函数）、**AIP Chatbot Studio**（agent 构建）、**AIP Evals**（评估）、**AIP Assist**（平台助手）、**AIP Document Intelligence**（文档抽取）、**Model Studio**（无代码模型训练）、**Code Workspaces**。

---

## 6. 研究方法论（供复现）

本机环境限制：WebFetch 被阻断、Google/Bing 被墙 → 采用以下路径：

1. **SEC EDGAR（首选）**：`curl -A "research research@example.com"` 访问，EDGAR 要求 UA 含联系信息（否则 403）。8-K 的 exhibit 99.1 就是财报新闻稿全文
2. **官方产品页**：Contentful CMS 渲染，`"value":"..."` 正则从内嵌 JSON 提取正文
3. **官方文档站**：Next.js SPA，curl 拿不到 → 用 Chrome MCP（`use_browser`）真实渲染后 `extract` 正文
4. **sitemap.xml**：枚举全站页面 URL（发现 `/explore/`、实体解析等隐藏页面）
5. **结论锚定**：每个论断都带官方原文引用，标注来源 URL

---

## 7. 来源清单（全部一手）

1. [Q2 2026 财报新闻稿（SEC 8-K exhibit 99.1）](https://www.sec.gov/Archives/edgar/data/1321655/000132165526000039/a2026q2ex991pressrelease.htm)
2. [FY2025 10-K（SEC，2026-02 提交）](https://www.sec.gov/Archives/edgar/data/1321655/000132165526000011/pltr-20251231.htm)
3. [Foundry AI OS（AIP）产品页](https://www.palantir.com/platforms/foundry/foundry-ai-os/)
4. [Sovereign AI 页](https://www.palantir.com/protect-your-sovereignty/)
5. [Pipeline Builder AIP features](https://www.palantir.com/docs/foundry/pipeline-builder/pipeline-builder-aip/)
6. [Use LLM node 文档](https://www.palantir.com/docs/foundry/pipeline-builder/pipeline-builder-llm/)
7. [Self-host models with AIP 文档](https://www.palantir.com/docs/foundry/aip/self-host-models/)
8. [Create an object type 文档](https://www.palantir.com/docs/foundry/object-link-types/create-object-type/)
9. [Foundry Ontology 探索页（Ontology Hydration）](https://www.palantir.com/explore/platforms/foundry/ontology/)
10. [Entity Resolution 产品页](https://www.palantir.com/foundry-entity-resolution/)
11. [Semantic search 文档](https://www.palantir.com/docs/foundry/ontology/overview-semantic-search/)
12. [AIP 文档总览](https://www.palantir.com/docs/foundry/aip/overview/)
13. [AIP features 文档](https://www.palantir.com/docs/foundry/aip/aip-features/)

---

## 8. 备注与修正记录

- **Welder**：早期调查中曾将其当作确定的 Ontology 加速工具名提出。经官方文档站全量搜索（sitemap + 站内搜索 765 条结果）验证，**公开资料查无此名**，应为内部代号或已并入其他产品。本报告已不依赖该名词。
- 官方术语注意：**OAG**（Ontology-Grounded Generation）是 Palantir 对抗朴素 RAG 的专有概念；**Ontology Hydration** 是数据进 Ontology 的官方动词。
