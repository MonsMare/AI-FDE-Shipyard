# Meridian 控股集团演示数据集实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-08-06-meridian-demo-data-design.md` 实现 Meridian 控股集团演示数据集：确定性生成器（64 表）+ 全量数据 + sources/schemas 注册 + approved 规则 + 优化故事 README + 集成测试。

**Architecture:** 生成器 = `gen/tables.js`（表定义 DSL：列/规模/外键/脏数据规则，纯数据）+ `gen/index.js`（PRNG/CSV 写出/缩放/sources 注册/调用 schema-infer）。生成顺序保证外键一致性：集团维表 → 三板块维表（含跨源种子）→ 交易表 → 病症埋点。产物是开箱即用的 paip 项目 `company-group/`。

**Tech Stack:** Node 24（零依赖）、`bin/csv.js` 复用（stringify）、`bin/schema-infer.js` 真实推断 schemas、`node --test` 测试、mulberry32 PRNG（seed=20260806）。

## Global Constraints

- 零第三方依赖（复用 `palantir-aip-workflow/bin/csv.js` 的 `stringify`，require 相对路径）
- 固定种子 `mulberry32(20260806)`，所有随机决策走同一 PRNG 流，**不用 Math.random/Date**
- 同种子两次生成**逐字节一致**（确定性）
- CLI：`node gen/index.js <项目目录> [--rows <scale>]`（scale 默认 1.0，`--rows 0.1` 缩 10 倍）
- 外键一致性：所有子表外键从已生成父表采样，孤儿外键仅按显式埋点注入（~1% 订单）
- 表清单与规模以 spec §3 为准（64 表：集团 10 + 零售 21 + 制造 18 + SaaS 15）
- 跨源重复：150 对客户（三板块两两交集）+ 30 家供应商（零售∩制造）
- 数据文件用 LF 行尾 + 无 BOM；CSV 用 RFC 4180（bin/csv.js stringify）
- `company-group/output/` 与 `audit/` **不提交**（.gitignore）
- 生成器完成后跑 `bin/validate.js` + `bin/exec.js` 冒烟必须通过

---

### Task 1: 生成器骨架 + 集团层 10 表

**Files:**
- Create: `palantir-aip-workflow/demo-data/gen/index.js`
- Create: `palantir-aip-workflow/demo-data/gen/tables.js`（先只含集团层 10 表定义）
- Test: `palantir-aip-workflow/tests/demo-data.test.js`（本任务先写确定性用例）

**Interfaces:**
- Produces: `gen/tables.js` 导出 `TABLES`（数组，每项 `{id, dir, cols: [{name, type, gen}], rows, dirty?: fn, fks?: [{col, ref}]}`）；`gen/index.js` 导出 `generate(projectDir, scale) → {tables: string[], bytes}` + CLI；`rng()` 为 mulberry32 实例
- Consumes: `../../bin/csv.js` 的 `stringify`；`../../bin/schema-infer.js`（Task 5 才调用，本任务只生成 CSV + sources）

**表定义 DSL 设计（tables.js，全部板块共用）：**
```js
// 每表一个对象：
{
  id: 'employees', dir: 'group',
  rows: 2600,                        // 或 fn(ctx) → number（随 scale 缩放）
  cols: [
    { name: 'employee_id', gen: (r, ctx) => `E-${1000 + r}` },          // 确定性
    { name: 'name', gen: (r, ctx) => ctx.pick(ctx.names) },             // 从池采样
    { name: 'hire_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate()) },// 脏数据格式随机
  ],
  fks: [{ col: 'department_id', ref: 'departments', key: 'department_id' }],
  dirty: (row, ctx) => { /* 按概率注入脏数据：大小写/空白/REF/格式 */ },
}
// ctx: { rng, pick, randInt, randDate, dateFmt, moneyFmt, scale, tables: Map }
```
- `ctx.dateFmt(d)` 三格式随机：`YYYY-MM-DD`(50%) / `MM/DD/YYYY`(30%) / `DD-MM-YYYY`(20%)
- `ctx.moneyFmt(n)` 三格式随机：`1234.5`(50%) / `$1,234.50`(30%) / `1 234,50`(20%)

**Task 1 步骤：**
- [ ] **Step 1: 写确定性失败测试**（tests/demo-data.test.js）：`generate(tmp1, 0.1)` 与 `generate(tmp2, 0.1)` 两次运行，关键文件内容逐字节相等
- [ ] **Step 2: 运行确认失败**：`node --test tests/demo-data.test.js` → FAIL（module not found）
- [ ] **Step 3: 实现** gen/index.js（mulberry32 + ctx + CSV 写出 + sources 注册 + config/state.json）+ tables.js 集团层 10 表（employees 2600 / departments 40 / positions 120 / salary_records 8000 / attendance 12000 / performance_reviews 5200 / employee_exits 400 / group_finance 72 / cost_centers 60 / intercompany_transactions 200）
- [ ] **Step 4: 运行确认通过**：`node --test tests/demo-data.test.js` → PASS
- [ ] **Step 5: 提交**：`git add demo-data/gen tests/demo-data.test.js && git commit -m "feat(demo-data): 生成器骨架 + 集团层 10 表（确定性）"`

---

### Task 2: 跨源种子 + 零售板块 21 表

**Files:**
- Modify: `palantir-aip-workflow/demo-data/gen/tables.js`（+21 零售表 + 跨源种子定义）

**Interfaces:**
- Consumes: Task 1 的 DSL/ctx
- Produces: 跨源种子表导出 `DUPLICATE_CUSTOMERS`（150 对：`{retailId, mfgId, saasId, baseEmail, nameVariant}`）与 `DUPLICATE_SUPPLIERS`（30 家）；零售表定义

**零售表清单（21）：** customers_retail 5000 / memberships 1200 / products_retail 800 / categories 30 / price_history 3200 / stores 25 / inventory_retail 4000 / stock_movements 20000 / orders_retail 15000 / order_items 45000 / shipments 14000 / returns 1200 / payments 15000 / coupons 200 / campaigns 60 / campaign_redemptions 8000 / reviews 3000 / suppliers_retail 80 / purchases_retail 1500 / purchase_items 6000 / service_tickets 2000

**关键实现点：**
- 先生成跨源种子（150 客户：40 对三表全在、70 对零售∩SaaS、40 对零售∩制造；30 家供应商零售∩制造）→ 各板块 customers/suppliers 表先写种子行（ID 不同、邮箱大小写变体、名称变体），再补独立行
- 病症埋点：inventory_retail 中 8% 产品 stock > 90 天销量（销量从 order_items 聚合回填）；orders_retail 1% 孤儿 customer_id（`CUST-99999`）；payments 5% `failed`；shipments 10% 送达 > 7 天
- orders/order_items 外键：customer_id→customers_retail（99% 采样 + 1% 孤儿）、product_id→products_retail
- 表间一致性：price_history 与 products 价格联动（同产品不同期价格有涨跌）

**Task 2 步骤：**
- [ ] **Step 1: 写失败测试**：外键抽样断言——order_items 的 order_id 全部在 orders 中；orders 孤儿率 ≈1%；customers_retail 含 150 个种子客户的变体（按 baseEmail 匹配）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** tables.js 追加零售表 + 跨源种子
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** `git commit -m "feat(demo-data): 跨源种子 + 零售板块 21 表"`

---

### Task 3: 制造板块 18 表

**Files:**
- Modify: `palantir-aip-workflow/demo-data/gen/tables.js`（+18 制造表）

**Interfaces:**
- Consumes: 跨源种子（customers_mfg 复用 110 个种子客户、suppliers_mfg 复用 30 家）
- Produces: 制造表定义

**制造表清单（18）：** customers_mfg 1200 / products_mfg 300 / bills_of_materials 1500 / raw_materials 120 / material_inventory 800 / suppliers_mfg 40 / supplier_evaluations 120 / purchase_orders_mfg 2000 / purchase_items_mfg 5000 / production_orders 8000 / production_batches 8000 / work_centers 15 / machine_maintenance 300 / quality_checks 8000 / defects 2000 / shipments_mfg 3000 / quotations 1500 / invoices_mfg 3500

**关键实现点：**
- 病症埋点：supplier_evaluations 中 5 家低分（≤60）；quality_checks 次品率 6%（关联 3 个低分原料批次）；machine_maintenance 中 2 台机器缺维护记录（故障率关联）；quotations 30% 过期未转订单
- BOM 用量格式：`0.5 kg` / `500 g` / `0.5` 混用（脏数据）
- invoices_mfg 账期：30% 发票 due_date - invoice_date > 90 天（账期病症）
- 外键：batches→production_orders→products_mfg；quality_checks→batches；defects→quality_checks

**Task 3 步骤：**
- [ ] **Step 1: 写失败测试**：外键完整性（quality_checks.batch_id 全部存在）；次品率信号存在（defects 非空且集中于少数批次）；低分供应商存在
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** tables.js 追加制造表
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** `git commit -m "feat(demo-data): 制造板块 18 表"`

---

### Task 4: SaaS 板块 15 表

**Files:**
- Modify: `palantir-aip-workflow/demo-data/gen/tables.js`（+15 SaaS 表）

**Interfaces:**
- Consumes: 跨源种子（customers_saas 复用 110 个种子客户）
- Produces: SaaS 表定义

**SaaS 表清单（15）：** customers_saas 3000 / accounts 900 / contacts 2400 / plans 6 / subscriptions 6000 / usage_metrics 60000 / invoices_saas 6000 / payments_saas 5500 / support_tickets 4000 / ticket_escalations 600 / feature_requests 800 / churn_events 900 / channels 8 / marketing_leads 5000 / lead_conversions 1200

**关键实现点：**
- churn 前兆：900 个 churn 客户的 usage_metrics 最后 4 周用量递减曲线（前 8 周正常 → 骤降）；churn_events 含 cancel_reason 分类
- 欠费：invoices_saas 20% 状态 `overdue`（payments_saas 无对应成功记录）
- 工单积压：support_tickets 15% `open` 且 created_at > 7 天；escalations 关联 30% 高级客户
- 跨源种子：customers_saas 含 110 个种子客户（邮箱小写变体 + 公司名变体）
- usage_metrics 60K 行按订阅 × 周生成（每订阅 ~40 周 × 均值波动）

**Task 4 步骤：**
- [ ] **Step 1: 写失败测试**：churn 前兆存在（churn 客户的 usage 序列尾部均值 < 头部均值 50%）；overdue 发票存在；customers_saas 含种子客户
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** tables.js 追加 SaaS 表
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** `git commit -m "feat(demo-data): SaaS 板块 15 表"`

---

### Task 5: schema-infer 集成 + sources 注册 + approved 规则

**Files:**
- Modify: `palantir-aip-workflow/demo-data/gen/index.js`（生成后调用 schema-infer 生成 schemas/）
- Create: `palantir-aip-workflow/demo-data/gen/rules.js`（approved 规则：objects/links/transforms/merges 定义）
- Test: `palantir-aip-workflow/tests/demo-data.test.js`（+validate 集成用例）

**Interfaces:**
- Consumes: `../../bin/schema-infer.js`（spawnSync `node bin/schema-infer.js <csv> --sample 0` → schemas/<id>.schema.json）；Task 2 跨源种子（merges 的 left/right value 从种子取值）
- Produces: 完整 paip 项目：sources/*.json（64 个，path 绝对路径）、schemas/*.schema.json（64 个，真实推断）、approved/{objects,links,transforms,merges}.json、config.json、state.json（currentStep: review）

**规则设计（rules.js）：**
- transforms（15 条）：date 统一 cast ×3（attendance/stock_movements/orders_retail）、金额清洗 regex_replace+cast ×2（salary_records/payments）、邮箱 lower ×2（customers_retail/customers_saas）、姓名 trim ×2、SKU REF 规范化 regex_replace ×1、BOM 用量 cast ×1、状态 map 归一 ×2（orders_retail/production_orders）、负数量 map ×1（order_items）
- merges（20 对）：跨源客户 16 对（retail↔saas 8 / retail↔mfg 4 / mfg↔saas 4）+ 供应商 4 对（retail↔mfg）——left/right 各 `{source, key, value}`，value 从种子表取真实值
- objects/links：Customer/Order/Product/Supplier/Subscription 等 8 个对象 + 关联链接（用于 validate 完整通过）

**Task 5 步骤：**
- [ ] **Step 1: 写失败测试**：`generate()` 后 validateProject(projectDir) → ok:true
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** index.js 集成 schema-infer + rules.js 规则
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** `git commit -m "feat(demo-data): schema-infer 集成 + sources 注册 + approved 规则"`

---

### Task 6: paip 集成验证 + demo-data.test.js 完整化

**Files:**
- Modify: `palantir-aip-workflow/tests/demo-data.test.js`
- Create: `palantir-aip-workflow/demo-data/.gitignore`（output/ audit/）

**Interfaces:**
- Consumes: `bin/validate.js` validateProject、`bin/exec.js` execProject

**测试用例（完整集）：**
1. 确定性：同参数两次生成逐字节一致（--rows 0.05）
2. 外键完整性：order_items→orders、quality_checks→batches、subscriptions→customers_saas 全存在
3. 跨源重复：种子客户 150 对在三表可匹配（按 baseEmail 归一）
4. 病症可定位：库存积压子集存在、DSO>90 子公司存在、churn 前兆存在、低分供应商存在
5. paip 集成：validateProject ok → execProject ok → output/ 出现物化 CSV（规则 id 命名）

**Task 6 步骤：**
- [ ] **Step 1: 写失败测试**（exec 集成用例）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** .gitignore + 测试完整化
- [ ] **Step 4: 运行确认通过**：`node --test tests/demo-data.test.js`
- [ ] **Step 5: 提交** `git commit -m "test(demo-data): 确定性/外键/病症/paip 集成全量用例"`

---

### Task 7: demo-data/README.md 优化故事

**Files:**
- Create: `palantir-aip-workflow/demo-data/README.md`

**内容：** 公司设定 → 表清单（64 表分组）→ 数据孤岛说明（150 客户/30 供应商/对账不平）→ 脏数据说明 → 6 类病症定位指南（每类：现象 → 涉及表 → 关联查询命令示例 → 可优化动作）→ 使用指南（生成/缩放/跑 paip 全链/清理 output）

**Task 7 步骤：**
- [ ] **Step 1: 写 README.md**
- [ ] **Step 2: 验证**：`git diff --check`；命令示例全部真实可跑（生成后用 validate/exec 冒烟复核）
- [ ] **Step 3: 提交** `git commit -m "docs(demo-data): 优化故事 + 使用指南"`

---

### Task 8: 全量生成入库 + 最终验证 + 推送

**Files:**
- Create: `palantir-aip-workflow/company-group/**`（全量生成产物：data/ 64 CSV + sources/ 64 + schemas/ 64 + approved/ + config/state）

**步骤：**
- [ ] **Step 1: 全量生成**：`node gen/index.js company-group`（默认 scale 1.0，~30MB）
- [ ] **Step 2: 验收**：`node bin/validate.js company-group` → ✔；`node bin/exec.js company-group` → 产物出现（跑完清理 output/audit）；全量测试 `node --test tests/` 全绿
- [ ] **Step 3: 提交入库**：`git add demo-data company-group && git commit -m "feat(demo-data): Meridian 控股集团全量数据集（64 表）" && git push`
- [ ] **Step 4: 最终核对**：git status 干净、本地=远程；README 命令复核
