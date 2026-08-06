# Meridian 控股集团演示数据集（demo-data）

一套模拟"需要被优化的公司"全景数据的 paip 流水线演示资产：**64 张表、约 18 万行、~30MB**，覆盖控股集团 + 零售/制造/SaaS 三家子公司，内嵌 **3 类数据孤岛、5 层脏数据、6 类可定位的业务病症**。

```
demo-data/
├── README.md              # 本文档：优化故事 + 病症定位指南
├── gen/
│   ├── index.js           # 生成器（零依赖，固定种子 20260806，--rows 可缩放）
│   ├── tables.js          # 64 表定义（列/规模/外键/脏数据规则）
│   └── rules.js           # 预置 approved 规则（8 对象/5 链接/16 转换/20 合并）
└── company-group/         # 生成的开箱即用 paip 项目（已入库）
    ├── data/              # 64 张 CSV（group/ retail/ mfg/ saas 四子目录）
    ├── sources/           # 64 个数据源注册
    ├── schemas/           # 64 个 schema-infer 真实推断产物
    ├── approved/          # 预置转换/合并规则
    └── staging/           # 空（演示"待审查"步骤）
```

## 公司设定

**Meridian 控股集团**——一家"数据孤岛病"典型的中型集团：

| 子公司 | 业务 | 系统 | 核心表 |
|---|---|---|---|
| Meridian Retail | 电商（B2C + 门店）| 老 ERP（2005 年自研）| orders 15K / order_items 45K |
| Meridian Mfg | 工业品制造（B2B）| MES/生产系统（2015 年）| production_orders 8K / batches 8K |
| Meridian Cloud | 订阅制软件（SaaS）| CRM + 计费（2021 年）| usage_metrics 60K / subscriptions 6K |

三套系统独立演进：客户/供应商/产品在各系统里 **ID 不同、命名不同、日期格式不同**——集团想做统一客户视图/供应链优化/财务合并，被数据孤岛卡住。这就是"需要被优化"的根源。

## 数据孤岛（3 类）

1. **跨源重复客户 150 对**：同一客户在 2-3 套客户表中（零售 CUST-* / 制造 MC-* / SaaS SC-*），邮箱大小写不同、公司名有变体（`Acme Corp-100` / `acme corp 100 inc` / `ACME CORP (100)`）→ 可用 `paip-entity` 消解 + `paip-exec` 合并归并
2. **跨源重复供应商 30 家**：零售 SR-* / 制造 SM-* 两套 ID
3. **内部往来对账不平**：`intercompany_transactions` 的零售应付与制造应收不相等（漏记/错记）

## 脏数据（5 层）

| 层 | 示例 | 对应清洗规则（approved/transforms.json） |
|---|---|---|
| 大小写/空白 | `  Alice  ` / `BOB@X.COM` / `ACTIVE`/`Active` | `company_trim` / `email_lower_*` / `status_map_*` |
| 日期三格式 | `2026-08-05` / `08/05/2026` / `05-08-2026` | `date_md_to_iso` / `date_dmy_to_iso`（链式） |
| 金额格式 | `$1,234.50` / `1234.5` / `1 234,50` | `money_strip_symbols` → `money_cast_number`（链式） |
| REF 编码 | `REF-2026-xxx` SKU / `BATCH-123` | `sku_normalize` / `batch_id_normalize` |
| 结构问题 | 孤儿外键（1% 订单指向不存在客户）、负数量、空值 | `qty_abs`（负数量转正） |

## 业务病症定位指南（6 类）

> 每条病症 = 现象 → 涉及表 → 定位方法 → 可优化动作。所有命令基于生成后的 `company-group/`。

### 1. 库存积压
- **现象**：8% 的库存记录 stock > 8000（远超 90 天销量）
- **表**：`inventory_retail` × `order_items`（销量）× `purchases_retail`（补货）× `suppliers_retail`
- **定位**：`inventory_retail` 中 stock 前 10 的产品 → 查其销量与最近采购
- **优化**：按销量重设 reorder_level，暂停积压 SKU 补货，清仓促销（campaigns）

### 2. 供应商交期长 / 次品率高
- **现象**：15% 零售采购 lead_time > 30 天；制造 5 家供应商评分 ≤60；6% 质检 fail 集中于少数批次
- **表**：`purchases_retail` / `supplier_evaluations` / `quality_checks` × `defects` × `raw_materials`
- **优化**：供应商集中（30 家重复 → 统一谈判），低分供应商降份额，追查次品原料批次

### 3. 营销渠道 ROI 低
- **现象**：30% campaign 的 attributed_revenue < cost
- **表**：`campaigns`（成本/归因收入）× `campaign_redemptions` × `coupons`
- **优化**：砍低 ROI 渠道，预算转移到高转化渠道（对比 SaaS 侧 `marketing_leads` 渠道质量）

### 4. 应收账款账期长
- **现象**：制造子公司 DSO 长期 90+ 天；30% 制造发票 status=overdue（due 日已过）
- **表**：`group_finance`（DSO）× `invoices_mfg` × `customers_mfg`
- **优化**：重点客户账期谈判、逾期催收流程、授信额度管控（credit_limit）

### 5. SaaS 客户流失（churn）
- **现象**：900 个订阅取消；其 `usage_metrics` 后半程用量骤降至 15%（**前兆**）
- **表**：`churn_events` × `usage_metrics` × `subscriptions` × `support_tickets` × `invoices_saas`
- **优化**：用量骤降预警（<50% 即触发）、取消前挽留、欠费（20% overdue）自动提醒

### 6. 制造次品率
- **现象**：6% 质检 fail；WC-7 / WC-11 两台机器**无维护记录**（故障关联）
- **表**：`quality_checks` × `defects` × `production_batches` × `machine_maintenance` × `work_centers`
- **优化**：无维护机器的预防性保养计划、缺陷码 Top 项工艺改进、原料批次追溯

## 使用指南

### 生成 / 重新生成
```bash
# 全量（默认 scale 1.0，~30MB）
node demo-data/gen/index.js demo-data/company-group

# 10% 规模快速演示（~3MB）
node demo-data/gen/index.js demo-data/company-group --rows 0.1
```

### 跑通 paip 全链
```bash
cd palantir-aip-workflow

# 1. 校验已批准产物（应 ✔）
node bin/validate.js demo-data/company-group

# 2. 执行全部转换/合并（56 个物化产物到 output/）
node bin/exec.js demo-data/company-group

# 3. 单条执行 / 项目完整性
node bin/exec.js demo-data/company-group --transform money_cast_number
node bin/audit.js check demo-data/company-group

# 4. 查看结果
ls demo-data/company-group/output/          # 物化 CSV（规则 id 命名）
cat demo-data/company-group/output/merge_cust_rs_1.csv          # 客户归并结果
cat demo-data/company-group/output/merge_cust_rs_1-mapping.csv  # 右键值→左键值映射
cat demo-data/company-group/audit/audit.jsonl                    # 审计轨迹
```

### 清理执行产物
```bash
rm -rf demo-data/company-group/output demo-data/company-group/audit
```

### 用 paip skills 走完整流程（LLM 会话）
`paip-init`（项目已就绪可跳过）→ `paip-source`（sources 已注册）→ `paip-infer`（观察 schema → 建模）→ `paip-model`（新增清洗规则）→ `paip-entity`（识别跨源重复客户）→ `paip-review`（审批）→ `paip-exec`（物化）。

## 验证

- `node --test tests/demo-data.test.js`：17 用例（确定性逐字节一致 / 外键完整性 / 跨源种子匹配 / 病症可定位 / validate+exec 全链集成）
- 生成器确定性：同参数两次生成逐字节一致（固定种子 `20260806`，不用 Math.random）
