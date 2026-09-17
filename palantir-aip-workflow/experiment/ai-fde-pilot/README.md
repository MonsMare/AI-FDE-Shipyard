# AI-FDE 最小验证实验（方向 C：AI 驻场工程师）

- 日期：2026-08-08
- 依据：`docs/2026-08-08-paip-production-deep-analysis.md` §六 方向 C——Palantir 生产落地靠 FDE 人力，我们用 AI 扮演 FDE：AI 建模型、AI 清洗、AI 做 ER、AI 写期望、AI 自评交付。
- 目标：检验"AI-FDE"假设是否成立——给一个**陌生业务数据集**，AI 用 paip 技能栈端到端产出可信交付包。

## 一、实验设计

### 1.1 数据集（合成真实形态）
模拟一家集团企业的三个业务系统导出：
- `crm_customers.csv`：零售 CRM 客户主数据（脏：大小写/空白/混合电话格式）
- `saas_accounts.csv`：SaaS 订阅系统账户（**与 CRM 存在跨源重复实体**：同一客户不同 ID/名称变体）
- `saas_subscriptions.csv`：订阅事实表（引用 saas 账户键；含**负数量/退款差错信号**）
- `mfg_suppliers.csv`：制造业 ERP 供应商（**与 CRM 存在跨源重复**）
- `mfg_shipments.csv`：发货事实表（引用 mfg 供应商键）
- 混合日期格式（YYYY-MM-DD / MM/DD/YYYY / DD-MM-YYYY）、金额含 `$`/千分位/负号

设计要点（对齐可用性审计检查域）：跨源重复对 ~10%（ER 覆盖率可衡量）、引用表外键可验证命中率、业务信号可统计（负数量行数）。

### 1.2 AI-FDE 角色
一个独立 agent 会话，**只能**使用 paip 技能栈（`palantir-aip-workflow/skills/*/SKILL.md` + `bin/` 引擎）完成全部工作，产出交付包。不得凭空写产物——一切产物必须经 `bin/validate.js` 校验、`bin/exec.js` 执行。

### 1.3 交付包（对齐 Palantir 生产机制 M11-M18 的最小集）
| # | 交付物 | 对应 Palantir 机制 | 验收判据 |
|---|---|---|---|
| D1 | 数据源注册 + schema 推断 | Ontology Hydration / Infer schema | sources/ + schemas/ 经 validate 通过 |
| D2 | 对象/属性/链接建模 | Ontology Manager | objects.json 经 validate；属性覆盖全部列 |
| D3 | 清洗规则 + 规则自评 | Pipeline Builder Generate + evals | 规则经 validate；eval 显示清洗前后残留 |
| D4 | 实体消解声明（含覆盖率） | Entity Resolution | 声明经 validate；报告覆盖率与置信度 |
| D5 | 期望定义（pre/post-condition） | Data Expectations | expectations.json 存在；exec 后期望全部通过或明确 fail |
| D6 | 执行产物 + 审计 | Builds + audit | output/ 物化；audit.jsonl 事件完整 |
| D7 | 可用性自评报告 | Data Health 等价物 | 对齐 output-audit 检查域：完整性/质量/关联/信号/覆盖率，逐项自评 |
| D8 | 维护文档（期望先行） | Building a Production Pipeline | 刷新率/正确性保证/失败策略/维护者职责 |

### 1.4 评分（AI-FDE 假设成立判定）
| 域 | 判据 |
|---|---|
| 流程合规 | 全程用 bin/ 引擎，validate/exec 通过，无手工造产物 |
| 质量门禁 | D5 期望全部定义且 exec 后全部满足（或 fail 有明确处置） |
| 关联保留 | 引用表外键命中率 ≥ 95%（对比 A2 的 0/2604 教训） |
| 信号保留 | 负数量信号不被静默抹除（对比 B6 教训） |
| ER 覆盖率 | 声明覆盖率 ≥ 90%（对比 A4 的 8% 教训） |
| 自评诚实 | D7 逐项给出真实数据，不掩盖问题 |

## 二、运行方式

```bash
# 1. 生成数据集（固定种子）
node experiment/ai-fde-pilot/gen.js <输出目录>

# 2. AI-FDE 子代理对输出目录执行 paip 流程（skills + bin/）
# 3. 评估：node experiment/ai-fde-pilot/eval.js <项目目录>（检查 D1-D8）
```

## 三、预期风险与对照
- AI-FDE 可能重蹈 paip 历史教训（物理改键/无期望/覆盖率低）→ 这正是实验价值：检验"技能栈是否能约束 AI 行为"，与 08-07 审计的 A1-A4/B6 对照。
- 若 AI-FDE 交付质量显著优于历史 demo（关联保留、信号保留、覆盖率达标），则方向 C 成立：技能栈+引擎可作为 AI 交付服务的基础设施。
