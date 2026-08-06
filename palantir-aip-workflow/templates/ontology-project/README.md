# Ontology 项目文件规范

本项目遵循 Palantir AIP 风格的 Ontology 构建流水线（参考 `palantir-like-workflow/README.md`）。

## 目录结构

```
<ontology-project>/
├── config.json          # 项目配置：状态机、LLM 偏好、目录默认值
├── state.json           # 流水线状态：步骤进度、已注册源、已提交对象/链接/转换
├── sources/             # 数据源注册信息（每个源一个 .json）
├── schemas/             # schema 推断结果（每个源一个 .schema.json）
├── staging/             # 待审查的生成产物
│   ├── objects.json     # LLM 建议的对象类型（待审查）
│   ├── links.json       # LLM 建议的链接类型（待审查）
│   ├── transforms.json  # LLM 建议的转换逻辑（待审查）
│   └── merges.json      # LLM 建议的实体合并（待审查）
├── approved/            # 已审查通过的正式产物
│   ├── objects.json
│   ├── links.json
│   ├── transforms.json
│   └── merges.json
├── output/              # exec 物化产物（output/<规则id>.csv，不覆盖原数据）
├── audit/               # 审计日志（事件追加，供复查与回滚）
│   └── audit.jsonl
└── data/                # （可选）示例/本地数据文件，供测试与演示
```

## 状态机

```
init → source → infer → model → entity → review → exec
```

- `source`：注册数据源 + schema 推断（确定性工具）
- `infer`：LLM 从 schema 推断对象类型/属性/链接（语义建模）
- `model`：LLM 生成转换逻辑（业务逻辑作为确定性工具，不进 prompt）
- `entity`：LLM 做实体消解（跨源去重）
- `review`：人工审查 staging → 批准进 approved + 审计日志
- `exec`：执行已批准规则 → 物化 output/（bin/exec.js，失败中止零副作用）

## 审计日志格式（audit/audit.jsonl）

每行一个 JSON 事件：
```json
{"id": 1, "ts": "ISO8601", "step": "source", "action": "source_registered", "target": "<源名>", "detail": "..."}
{"id": 2, "ts": "ISO8601", "step": "infer", "action": "objects_proposed", "target": "staging/objects.json", "detail": "5 个对象类型"}
{"id": 3, "ts": "ISO8601", "step": "review", "action": "object_approved", "target": "Customer", "detail": "用户批准"}
```

## 产物格式

### 对象类型（objects.json）
```json
{
  "objects": [
    {
      "id": "Customer",
      "displayName": "客户",
      "description": "购买产品的个人或组织",
      "backingSource": "customers.csv",
      "properties": [
        {"id": "customerId", "type": "string", "title": "客户 ID", "primaryKey": true},
        {"id": "name", "type": "string", "title": "姓名"},
        {"id": "email", "type": "string", "title": "邮箱"}
      ],
      "proposedBy": "paip-infer",
      "status": "staged"
    }
  ]
}
```

### 转换逻辑（transforms.json）—— 业务逻辑作为确定性工具
```json
{
  "transforms": [
    {
      "id": "normalize_email",
      "source": "customers.csv",
      "target": "清洗邮箱（描述性，不控制输出路径）",
      "type": "regex_replace",
      "rule": {"pattern": "\\s+", "replacement": "", "column": "email"},
      "description": "去除邮箱中的空白字符",
      "status": "staged"
    }
  ]
}
```
- 转换必须是**确定性规则**（正则/映射/过滤），LLM 生成后由人确认——符合 Palantir"逻辑不进 prompt"原则
- 规则 type 权威枚举 9 种：`regex_replace | regex_extract | map | filter | concat | split | cast | lower | upper | trim`（参数见 `skills/paip-model/SKILL.md` 参数表或 `bin/validate.js`）
- `target` 字段**仅描述性**，不控制输出路径；执行后产物按规则 id 命名 `output/<id>.csv`

### 实体合并（merges.json）—— 键映射替换
```json
{
  "merges": [
    {
      "id": "merge-001",
      "left": {"source": "customers.csv", "key": "customerId", "value": "c1"},
      "right": {"source": "leads.csv", "key": "contactEmail", "value": "a@x.com"},
      "confidence": 0.93,
      "rationale": "邮箱一致，姓名相似",
      "status": "staged"
    }
  ]
}
```
- `left/right` 各含 `source`（已注册源）、`key`（该源的列）、`value`（LLM 判定的匹配键值）
- 执行语义（bin/exec.js）：构建 右键值→左键值 映射表 → 右表匹配行主键替换为左键值并入左表；左表优先、同名列进 `_right`、右表独有列补齐
- 产物：`output/<merge-id>.csv`（合并后表）+ `output/<merge-id>-mapping.csv`（映射表，列 `right,left`）
