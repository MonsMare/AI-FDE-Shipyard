# Meridian 控股集团演示数据集设计（demo-data）

- 日期：2026-08-06
- 主题：为 paip 流水线构建一套真实感、高关联复杂度的公司数据集（模拟一家"需要被优化的公司"的全景）
- 关联：`palantir-aip-workflow/`（paip v2.0 引擎，本数据集是它的完整演示资产）

---

## 1. 背景与目标

### 问题
paip v2.0 已实现确定性执行引擎（csv/validate/exec/audit + 8 skills + 52 测试），但现有演示数据仅 `tests/fixtures/demo`（customers+orders 各 4 行）——无法展示：
- 多源高关联网络（外键链、跨表多跳）
- 跨系统数据孤岛与重复实体（实体消解 + 合并的核心场景）
- 真实规模的脏数据（日期/金额/编码多格式并存）
- "优化一家公司"的业务叙事（库存积压/供应商交期/渠道 ROI/账期/churn/次品率）

### 用户需求（已澄清）
1. 一套**多业务集团**数据集：控股集团 + 零售/制造/SaaS 三家子公司，各跑孤立系统
2. 规模"平常公司"级：**员工数千人，每板块表单 15+ 张，核心表万级行**
3. 作为 `demo-data/` 完整演示资产：数据 + 生成器 + sources 注册 + approved 规则 + 优化故事 README
4. 全量产物提交入库（~30MB）

### 成功标准
1. `node gen/index.js` 生成全量数据，同种子两次生成逐字节一致（确定性）
2. 生成项目通过 `bin/validate.js` 与 `bin/exec.js` 全链冒烟
3. 数据中可识别全部 6 类业务病症 + 3 类数据孤岛场景
4. `tests/demo-data.test.js` 覆盖确定性 + paip 集成

---

## 2. 公司设定

**Meridian 控股集团**——一家"数据孤岛病"典型的中型集团：

| 子公司 | 业务 | 系统 | 员工占比 |
|---|---|---|---|
| Meridian Retail | 电商（B2C + 门店）| 老 ERP（自研，2005 年）| ~55% |
| Meridian Mfg | 工业品制造（B2B）| MES/生产系统（2015 年）| ~30% |
| Meridian Cloud | 订阅制软件（SaaS）| CRM + 计费系统（2021 年）| ~15% |

三套系统独立演进：客户/供应商/产品在各系统里 **ID 体系不同、命名规范不同、日期格式不同**——这是"需要被优化"的根源（集团层想做统一客户视图/供应链优化/财务合并，被数据孤岛卡住）。

---

## 3. 数据模型（64 张表）

### 3.1 集团层（10 表）—— HR + 财务

| 表 | 规模 | 关键列 | 脏数据/病症设计 |
|---|---|---|---|
| `employees.csv` | 2,600（在职 2,200 + 离职 400）| employee_id, name, department_id, position_id, subsidiary, hire_date, salary, email | 姓名大小写/空白；邮箱变体；薪资带千分位 |
| `departments.csv` | 40 | department_id, name, subsidiary, cost_center_id | — |
| `positions.csv` | 120 | position_id, title, grade, base_salary_range | — |
| `salary_records.csv` | 8,000 | employee_id, month, base_salary, bonus, deductions | 金额格式不一（$1,234.50 / 1234.5）|
| `attendance.csv` | 12,000 | employee_id, date, hours, overtime, status | 日期三格式并存 |
| `performance_reviews.csv` | 5,200 | employee_id, review_date, score, rating, notes | 分数格式（4.5 vs 4 vs "A"）|
| `employee_exits.csv` | 400 | employee_id, exit_date, reason, department_id | 离职原因分类（主动/被动/裁员）——高离职率部门可分析 |
| `group_finance.csv` | 3×24=72 | subsidiary, month, revenue, receivable, days_sales_outstanding, inventory_value, headcount | **账期 90+ 天信号** |
| `cost_centers.csv` | 60 | cost_center_id, name, subsidiary, budget, spent | — |
| `intercompany_transactions.csv` | 200 | txn_id, from_subsidiary, to_subsidiary, amount, date, description | 内部往来对账不平（零售应付 vs 制造应收）|

### 3.2 零售板块（21 表）—— 电商 + 门店全链路

| 表 | 规模 | 外键链 | 脏数据/病症 |
|---|---|---|---|
| `customers_retail.csv` | 5,000 | — | **跨源重复实体（150 对之一）**；邮箱大小写 |
| `memberships.csv` | 1,200 | customer_id→customers | 会员等级大小写（gold/GOLD）|
| `products_retail.csv` | 800 | supplier_id→suppliers | SKU 含 REF 编码 |
| `categories.csv` | 30 | parent_id 自引用 | — |
| `price_history.csv` | 3,200 | product_id→products | 价格带货币符 |
| `stores.csv` | 25 | region | — |
| `inventory_retail.csv` | 4,000 | product_id→products, store_id→stores | **库存积压信号**（stock > 90 天销量）|
| `stock_movements.csv` | 20,000 | product_id, store_id | 日期三格式 |
| `orders_retail.csv` | 15,000 | customer_id→customers, store_id→stores, coupon_id→coupons | **孤儿外键**（~1% 订单指向不存在客户）；订单状态大小写 |
| `order_items.csv` | 45,000 | order_id→orders, product_id→products | 数量/单价异常（负数量）|
| `shipments.csv` | 14,000 | order_id→orders | **物流时长信号**（发货→送达天数）|
| `returns.csv` | 1,200 | order_item_id→order_items | **退货率高品类信号** |
| `payments.csv` | 15,000 | order_id→orders | **支付失败率信号**；金额格式 |
| `coupons.csv` | 200 | — | 折扣率格式（0.2 vs 20%）|
| `campaigns.csv` | 60 | — | **渠道 ROI 信号**（成本 vs 归因订单）|
| `campaign_redemptions.csv` | 8,000 | campaign_id, coupon_id | — |
| `reviews.csv` | 3,000 | product_id, customer_id | 评分 1-5 与文字混杂 |
| `suppliers_retail.csv` | 80 | — | **跨源重复供应商（与制造共用 30 家）** |
| `purchases_retail.csv` | 1,500 | supplier_id→suppliers | **交期信号**（下单→到货天数）|
| `purchase_items.csv` | 6,000 | purchase_id, product_id | — |
| `service_tickets.csv` | 2,000 | customer_id→customers | **工单积压信号**（未关闭）|

### 3.3 制造板块（17 表）—— MES/生产全链路

| 表 | 规模 | 外键链 | 脏数据/病症 |
|---|---|---|---|
| `customers_mfg.csv` | 1,200 | — | **跨源重复实体（150 对之一）** |
| `products_mfg.csv` | 300 | — | 产品编码大小写混用 |
| `bills_of_materials.csv` | 1,500 | product_id→products, material_id→raw_materials | BOM 用量格式（kg vs g）|
| `raw_materials.csv` | 120 | supplier_id→suppliers_mfg | — |
| `material_inventory.csv` | 800 | material_id→raw_materials | 库存单位不统一 |
| `suppliers_mfg.csv` | 40 | — | **与零售供应商 30 家重复（ID 不同）** |
| `supplier_evaluations.csv` | 120 | supplier_id→suppliers_mfg | **次品率信号**（evaluation_score 低）|
| `purchase_orders_mfg.csv` | 2,000 | supplier_id→suppliers_mfg | — |
| `purchase_items_mfg.csv` | 5,000 | po_id, material_id | — |
| `production_orders.csv` | 8,000 | product_id→products_mfg, work_center_id | 状态不一致（open/OPEN）|
| `production_batches.csv` | 8,000 | order_id→production_orders, material_id | 批次号 REF 编码 |
| `work_centers.csv` | 15 | — | — |
| `machine_maintenance.csv` | 300 | machine_id→work_centers | **维护缺失信号**（故障率关联）|
| `quality_checks.csv` | 8,000 | batch_id→production_batches | **次品率信号**（pass/fail + defect 数）|
| `defects.csv` | 2,000 | check_id→quality_checks, batch_id | 缺陷编码 |
| `shipments_mfg.csv` | 3,000 | customer_id→customers_mfg | — |
| `quotations.csv` | 1,500 | customer_id→customers_mfg | 报价有效期过期未转订单（**转化率信号**）|
| `invoices_mfg.csv` | 3,500 | customer_id, quotation_id | **账期信号**（due_date - invoice_date）|

### 3.4 SaaS 板块（16 表）—— CRM + 计费

| 表 | 规模 | 外键链 | 脏数据/病症 |
|---|---|---|---|
| `customers_saas.csv` | 3,000 | — | **跨源重复实体（150 对之一）**；联系人名空白 |
| `accounts.csv` | 900 | customer_id→customers_saas | 企业账号（客户=联系人层）|
| `contacts.csv` | 2,400 | account_id→accounts | 电话格式不一 |
| `plans.csv` | 6 | — | — |
| `subscriptions.csv` | 6,000 | customer_id, plan_id, account_id | **churn 信号**（cancel_reason）|
| `usage_metrics.csv` | 60,000 | subscription_id→subscriptions | **用量骤降信号**（churn 前兆）|
| `invoices_saas.csv` | 6,000 | subscription_id→subscriptions | **欠费信号**；金额格式 |
| `payments_saas.csv` | 5,500 | invoice_id→invoices_saas | 支付失败重试 |
| `support_tickets.csv` | 4,000 | customer_id, subscription_id | **工单积压 + 升级信号** |
| `ticket_escalations.csv` | 600 | ticket_id→support_tickets | — |
| `feature_requests.csv` | 800 | customer_id | — |
| `churn_events.csv` | 900 | customer_id, subscription_id | 流失原因分类（**churn 分析主表**）|
| `channels.csv` | 8 | — | — |
| `marketing_leads.csv` | 5,000 | channel_id→channels | **线索质量信号**（lead 来源 vs 转化）|
| `lead_conversions.csv` | 1,200 | lead_id→marketing_leads, customer_id | — |

**合计：10 + 21 + 18 + 15 = 64 张表**（集团 10 + 零售 21 + 制造 18 + SaaS 15）

> 规模核对：核心表（orders 15K / order_items 45K / usage 60K / attendance 12K / salary 8K / batches+checks 16K）总行数 ~180K，文件体积估计 ~25-40MB。

---

## 4. "病"的设计（优化的价值所在）

### 4.1 数据孤岛（3 类）
1. **跨源重复客户**：150 个客户同时在零售/制造/SaaS 三套客户表中（部分两套），ID 不同、邮箱大小写不同、名称有变体（`Acme Corp` / `acme co` / `ACME 集团`）→ paip-entity 消解 + exec merge 的天然演示
2. **跨源重复供应商**：30 家供应商同时在零售/制造两套供应商表中（ID 不同）
3. **内部往来对账不平**：intercompany_transactions 中零售应付总额 ≠ 制造应收总额（漏记/错记）

### 4.2 脏数据（5 层）
- 大小写/空白（姓名/邮箱/状态/会员等级）
- 日期三格式并存（`YYYY-MM-DD` / `MM/DD/YYYY` / `DD-MM-YYYY`）→ cast 演示
- 金额格式（`$1,234.50` / `1234.5` / 千分位）→ regex_replace 演示
- REF 编码（SKU/批次/工单号 `REF-2026-xxxx`）→ 规范化演示
- 孤儿外键（~1% 订单指向不存在客户）、空值、负数量、重复行

### 4.3 业务病症（6 类，均可通过关联分析定位）
1. **库存积压**：inventory 的 stock 超过 90 天销量（对应产品 + 供应商 + 采购记录可追溯）
2. **供应商交期长/次品率高**：purchases 交期天数 + supplier_evaluations 低分 + defects 高发批次
3. **营销渠道 ROI 低**：campaigns 成本 vs campaign_redemptions 归因订单收入
4. **应收账款账期长**：group_finance DSO > 90 + invoices_mfg 账期分布
5. **SaaS 客户流失**：usage_metrics 骤降 → churn_events（流失前兆可识别）
6. **制造次品率**：quality_checks fail 关联到特定 raw_materials 批次 / machine_maintenance 缺失

---

## 5. 生成器设计（gen/index.js）

- **零依赖 Node**，`mulberry32` 固定种子（seed=20260806），同种子逐字节一致
- **参数**：`node gen/index.js <项目目录> [--rows <scale>]`（scale 默认 1.0，`--rows 0.1` 缩 10 倍快速演示）
- **生成顺序**（保证外键一致性）：
  1. 集团主数据（departments/positions/cost_centers）
  2. 三板块维表（customers/products/suppliers/stores/plans/channels…）——先定义 150 对跨源重复客户与 30 家重复供应商的**共享种子表**，再在各板块表里生成变体
  3. 交易表（orders/order_items/usage/batches…）——外键从已生成表随机采样
  4. 病症埋点（按概率注入：孤儿外键 1%、日期格式三选一、金额格式三选一、库存积压产品子集、churn 前兆用量曲线…）
  5. sources/*.json 注册（path 绝对/相对指向 data/）+ config.json/state.json
  6. 调用 `bin/schema-infer.js` 生成 schemas/（真实推断，非手写）
- **确定性**：所有随机决策走同一 PRNG 流（不依赖 Math.random/时间）

## 6. 预置规则（approved/，演示 exec）

- **转换**（transforms.json，约 15 条）：
  - 日期统一：cast date ×3（三张表）
  - 金额清洗：regex_replace 去 `$`/千分位 → cast number
  - 邮箱/姓名：lower + trim
  - SKU/批次 REF 规范化：regex_replace `REF-\d+` → 规范格式
  - 数量绝对值：map 负数量 → 0 或 abs（演示 map）
  - 状态归一：map 大小写变体 → 标准枚举
- **合并**（merges.json，约 20 对）：
  - 跨源客户消解：零售↔SaaS（10 对）、零售↔制造（6 对）、制造↔SaaS（4 对），left/right 各含 {source, key, value}
  - 跨源供应商消解：零售↔制造（5 对）
- 规则全部通过 `bin/validate.js` 校验（schema 列名一致）

## 7. 目录结构与交付

```
palantir-aip-workflow/demo-data/
├── README.md              # 优化故事 + 表清单 + 病症定位指南 + 使用说明
├── gen/
│   ├── index.js           # 生成器（零依赖，固定种子）
│   └── tables.js          # 表定义（列/规模/外键/脏数据规则）——与 index.js 分离，便于扩展
├── company-group/         # 生成的开箱即用 paip 项目（提交入库）
│   ├── config.json / state.json
│   ├── data/              # 64 张 CSV（group/ retail/ mfg/ saas 四子目录）
│   ├── sources/           # 63 个注册 JSON
│   ├── schemas/           # schema-infer 真实推断产物（63 个）
│   ├── approved/          # objects/links/transforms/merges
│   ├── staging/           # 空（演示待审查步骤）
│   └── output/            # exec 产物（生成器运行后产生，提交或不提交见下）
```

- **output/** 与 **audit/**：生成后由测试/演示产生，**不提交入库**（.gitignore）——保持仓库为"干净输入态"
- 体积控制：64 张 CSV ~30MB 提交入库（用户已确认全量入库）

## 8. 测试（tests/demo-data.test.js）

1. **确定性**：同种子两次生成 → 逐字节一致（生成到两个临时目录，比较关键文件 hash）
2. **paip 集成**：生成项目 → `validateProject` ok → `execProject` ok → output/ 出现物化 CSV（按规则 id）
3. **外键完整性**：抽样断言——order_items 的 order_id 全部存在于 orders；orders 的 customer_id 孤儿率 ≈1%；跨源重复客户数量 = 150
4. **病症可定位**：断言库存积压产品子集存在、churn_events 非空、DSO>90 的子公司存在

## 9. 范围与未来

- **本次做**：63 表全量生成 + 规则 + 文档 + 测试
- **不做**（YAGNI）：多语言生成器、可视化脚本、分析仪表盘（README 提供 SQL/命令示例即可）
- **未来**：`--rows` 缩放已预留；可加第五板块（物流）或集团统一客户主数据视图

## 10. 参考

- paip 引擎与数据流：`spec/2026-08-05-paip-engineering-design.md`（§3/§4/§6）
- 现有小型 demo：`tests/fixtures/demo/`
- 生成器 PRNG 参考：`experiment/scale-benchmark/scripts/gen.js`（mulberry32）
