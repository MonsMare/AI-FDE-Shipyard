# Ontology 项目文件规范（ai-fde-pilot-ontology）

本项目遵循 Palantir AIP 风格的 Ontology 构建流水线（参考 `palantir-like-workflow/README.md`），由 paip 技能栈驱动。

## 目录结构

```
<ontology-project>/
├── config.json          # 项目配置：状态机、LLM 偏好、目录默认值
├── state.json           # 流水线状态：步骤进度、已提交对象/链接/转换
├── sources/             # 数据源注册信息（每个源一个 .json）
├── schemas/             # schema 推断结果（每个源一个 .schema.json）
├── staging/             # 待审查的生成产物
│   ├── objects.json     # 对象类型（待审查）
│   ├── links.json       # 链接类型（待审查）
│   ├── transforms.json  # 转换逻辑（待审查）
│   └── merges.json      # 实体合并声明（待审查）
├── approved/            # 已审查通过的正式产物
│   ├── objects.json
│   ├── links.json
│   ├── transforms.json
│   └── merges.json
├── output/              # exec 物化产物（output/<规则id>.csv，不覆盖原数据）
├── audit/               # 审计日志（audit.jsonl，事件追加）
├── tools/               # AI-FDE 辅助脚本（侦察/生成/核对，宿主可复现）
└── data/                # （可选）示例/本地数据文件
```

## 状态机

```
init → source → infer → model → entity → review → exec
```

## 本交付关键决策（记录在案，防回退）

1. **清洗规则全部为确定性单列规则**（trim/lower/regex/cast），45 条，链式执行；日期统一 ISO、金额去 `$`/千分位/逗号小数、数量 cast 整数。
2. **负数量是退款差错业务信号，禁止转正**（历史教训 B6）：`quantity` 仅 `cast integer`（保留 `-` 号），无任何 filter/abs 规则。
3. **实体消解为确定性 email 精确匹配**（trim+lower 规范化后 join），160 对声明（CRM↔SAAS 120 + CRM↔MFG 40），置信度 0.99，不依赖 LLM 拍板。
4. **不物理改写任何主键**（历史教训 A2）：subscriptions 的 account_id / shipments 的 supplier_id 引用保持原值；键映射产物（mapping 声明）供下游 canonical join。
5. **merge 物化被有意跳过**（历史教训 A1：v2.1 引擎 merge 语义为"右表匹配行追加"，合并产物必然主键重复 → 下游 join fan-out）：ER 以声明（staging/merges.json + 覆盖率报告）交付，物化合并表待引擎 v2.2 修复"合并行语义"后再启用。详见 delivery-report.md §6。
