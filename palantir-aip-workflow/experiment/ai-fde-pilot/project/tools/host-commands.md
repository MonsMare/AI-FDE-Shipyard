# 宿主代跑命令清单（AI-FDE 交付验证）

> 背景：本 AI-FDE 子代理会话无命令执行通道（无 bash 工具；read_only 子代理的 bash 白名单拦截所有 node 命令——已实测 3 次），全部引擎命令需宿主在 `C:\Users\meta\Code\研究中心\marble-pillar`（workspace 根）执行。所有产物文件已就绪并按引擎规范编写。

## 0. 前置

```bash
cd palantir-aip-workflow
```

## 1. schema 复核（建议，覆盖静态推断的 schemas/）

```bash
node bin/schema-infer.js experiment/ai-fde-pilot/data/crm_customers.csv          > experiment/ai-fde-pilot/project/schemas/crm_customers.csv.schema.json
node bin/schema-infer.js experiment/ai-fde-pilot/data/saas_accounts.csv          > experiment/ai-fde-pilot/project/schemas/saas_accounts.csv.schema.json
node bin/schema-infer.js experiment/ai-fde-pilot/data/saas_subscriptions.csv     > experiment/ai-fde-pilot/project/schemas/saas_subscriptions.csv.schema.json
node bin/schema-infer.js experiment/ai-fde-pilot/data/mfg_suppliers.csv          > experiment/ai-fde-pilot/project/schemas/mfg_suppliers.csv.schema.json
node bin/schema-infer.js experiment/ai-fde-pilot/data/mfg_shipments.csv          > experiment/ai-fde-pilot/project/schemas/mfg_shipments.csv.schema.json
```
（覆盖后列名不变，validate 不受影响；覆盖可消除"静态推断类型"偏差。）

## 2. 状态机推进（严格顺序）

```bash
node bin/audit.js step experiment/ai-fde-pilot/project source
node bin/audit.js step experiment/ai-fde-pilot/project infer
node bin/audit.js step experiment/ai-fde-pilot/project model
node bin/audit.js step experiment/ai-fde-pilot/project entity
node bin/audit.js step experiment/ai-fde-pilot/project review
```

## 3. 审计事件（audit/audit.jsonl ≥5 条）

```bash
node bin/audit.js log experiment/ai-fde-pilot/project source source_registered crm_customers.csv "8 列 1200 行"
node bin/audit.js log experiment/ai-fde-pilot/project source source_registered saas_accounts.csv "6 列 400 行"
node bin/audit.js log experiment/ai-fde-pilot/project source source_registered saas_subscriptions.csv "8 列 3000 行"
node bin/audit.js log experiment/ai-fde-pilot/project source source_registered mfg_suppliers.csv "6 列 200 行"
node bin/audit.js log experiment/ai-fde-pilot/project source source_registered mfg_shipments.csv "8 列 2000 行"
node bin/audit.js log experiment/ai-fde-pilot/project infer objects_proposed staging/objects.json "5 个对象类型, 4 个链接"
node bin/audit.js log experiment/ai-fde-pilot/project model transforms_proposed staging/transforms.json "45 条转换规则"
node bin/audit.js log experiment/ai-fde-pilot/project entity merges_proposed staging/merges.json "160 条合并声明（确定性 email 匹配）"
node bin/audit.js log experiment/ai-fde-pilot/project review objects_approved approved/objects.json "5 个对象批准"
node bin/audit.js log experiment/ai-fde-pilot/project review links_approved approved/links.json "4 个链接批准"
node bin/audit.js log experiment/ai-fde-pilot/project review transforms_approved approved/transforms.json "45 条转换批准"
node bin/audit.js log experiment/ai-fde-pilot/project review merges_deferred staging/merges.json "ER 声明暂缓物化（引擎 v2.1 merge 语义与 A1 冲突，见 delivery-report §6）"
```

## 4. 校验（staging → approved）

```bash
node bin/validate.js experiment/ai-fde-pilot/project --stage   # 预期 ✔ staging 产物校验通过
node bin/validate.js experiment/ai-fde-pilot/project           # 预期 ✔ approved 产物校验通过
```

## 5. 规则效果评估（45 条，每条输出 before/after/changes JSON）

```bash
cd experiment/ai-fde-pilot/project
for id in crm_company_name_trim crm_company_name_lower crm_email_trim crm_email_lower crm_phone_trim crm_created_date_mmddyyyy crm_created_date_ddmmyyyy crm_created_date_cast saas_account_name_trim saas_account_name_lower saas_account_email_trim saas_account_email_lower saas_signup_date_mmddyyyy saas_signup_date_ddmmyyyy saas_signup_date_cast subs_unit_price_currency subs_unit_price_thousands subs_unit_price_comma_decimal subs_unit_price_cast subs_quantity_cast subs_start_date_mmddyyyy subs_start_date_ddmmyyyy subs_start_date_cast subs_end_date_mmddyyyy subs_end_date_ddmmyyyy subs_end_date_cast mfg_supplier_name_trim mfg_supplier_name_lower mfg_supplier_email_trim mfg_supplier_email_lower mfg_since_date_mmddyyyy mfg_since_date_ddmmyyyy mfg_since_date_cast ship_unit_cost_currency ship_unit_cost_thousands ship_unit_cost_comma_decimal ship_unit_cost_cast ship_quantity_cast ship_order_date_mmddyyyy ship_order_date_ddmmyyyy ship_order_date_cast ship_arrival_date_mmddyyyy ship_arrival_date_ddmmyyyy ship_arrival_date_cast ship_lead_time_cast; do
  node ../../bin/eval.js . "$id" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.ruleId, 'rowDelta='+r.changes.rowDelta, 'emptyDelta='+r.changes.emptyDelta)})"
done
cd ../../..
```
预期：全部 rowDelta=0（无 filter）；日期/金额 cast 规则 emptyDelta=0（数据无未覆盖变体）；trim/lower 规则 emptyDelta=0。

## 6. 执行（物化 output/）

```bash
node bin/exec.js experiment/ai-fde-pilot/project
# 预期：✔ 执行完成，产物 45 个: output/crm_company_name_trim.csv ... output/ship_lead_time_cast.csv
#       ✔ 审计事件 45 条已记录
```

## 7. 期望核对 + 状态检查

```bash
node experiment/ai-fde-pilot/project/tools/verify.js experiment/ai-fde-pilot/project   # 预期全 ✔
node bin/audit.js check experiment/ai-fde-pilot/project                                 # 预期 ✔ 项目结构完整
node bin/audit.js state experiment/ai-fde-pilot/project                                 # currentStep 应为 exec
```

## 8. 实验评估（最终验收）

```bash
node experiment/ai-fde-pilot/eval.js experiment/ai-fde-pilot/project
# 预期 D1-D7 全 ✔：sources≥5、schemas≥5、objects、transforms≥5、ER 声明≥144、
#        expectations、output≥5、audit≥5、account_id 命中≥95%、负数量≥152
```

## 9. ER 复现（可选，验证声明可复现）

```bash
node experiment/ai-fde-pilot/project/tools/gen-merges.js   # 输出 160 条声明（应与 staging/merges.json 一致）
```
