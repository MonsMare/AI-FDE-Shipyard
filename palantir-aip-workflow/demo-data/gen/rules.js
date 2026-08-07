// rules.js — Meridian 演示数据集的预置 approved 规则（spec §6）
// objects/links/transforms/merges 定义；index.js 生成后写入 approved/。
// transforms 的列名必须与生成的表一致（validate 会对照 schema 校验）。
'use strict';

const OBJECTS = {
  objects: [
    {
      id: 'Customer', displayName: '零售客户', description: '零售板块客户',
      backingSource: 'customers_retail.csv',
      properties: [
        { id: 'customer_id', type: 'string', title: '客户 ID', primaryKey: true },
        { id: 'company_name', type: 'string', title: '公司名' },
        { id: 'email', type: 'string', title: '邮箱' },
        { id: 'phone', type: 'string', title: '电话' },
        { id: 'region', type: 'string', title: '区域' },
        { id: 'signup_date', type: 'string', title: '注册日期' },
      ], status: 'approved',
    },
    {
      id: 'RetailOrder', displayName: '零售订单', description: '零售板块订单',
      backingSource: 'orders_retail.csv',
      properties: [
        { id: 'order_id', type: 'string', title: '订单 ID', primaryKey: true },
        { id: 'customer_id', type: 'string', title: '客户 ID' },
        { id: 'store_id', type: 'string', title: '门店 ID' },
        { id: 'coupon_id', type: 'string', title: '优惠券 ID' },
        { id: 'order_date', type: 'string', title: '订单日期' },
        { id: 'status', type: 'string', title: '状态' },
        { id: 'total_amount', type: 'string', title: '订单总额' },
      ], status: 'approved',
    },
    {
      id: 'Product', displayName: '零售商品', description: '零售板块商品',
      backingSource: 'products_retail.csv',
      properties: [
        { id: 'product_id', type: 'string', title: '商品 ID', primaryKey: true },
        { id: 'name', type: 'string', title: '名称' },
        { id: 'category_id', type: 'string', title: '品类 ID' },
        { id: 'supplier_id', type: 'string', title: '供应商 ID' },
        { id: 'unit_price', type: 'string', title: '单价' },
      ], status: 'approved',
    },
    {
      id: 'Supplier', displayName: '供应商', description: '零售板块供应商',
      backingSource: 'suppliers_retail.csv',
      properties: [
        { id: 'supplier_id', type: 'string', title: '供应商 ID', primaryKey: true },
        { id: 'name', type: 'string', title: '名称' },
        { id: 'region', type: 'string', title: '区域' },
        { id: 'lead_time_days', type: 'integer', title: '交期天数' },
        { id: 'rating', type: 'integer', title: '评级' },
      ], status: 'approved',
    },
    {
      id: 'MfgProduct', displayName: '制造产品', description: '制造板块成品',
      backingSource: 'products_mfg.csv',
      properties: [
        { id: 'product_id', type: 'string', title: '产品 ID', primaryKey: true },
        { id: 'name', type: 'string', title: '名称' },
        { id: 'supplier_id', type: 'string', title: '供应商 ID' },
        { id: 'unit_price', type: 'string', title: '单价' },
      ], status: 'approved',
    },
    {
      id: 'Subscription', displayName: '订阅', description: 'SaaS 订阅',
      backingSource: 'subscriptions.csv',
      properties: [
        { id: 'subscription_id', type: 'string', title: '订阅 ID', primaryKey: true },
        { id: 'customer_id', type: 'string', title: '客户 ID' },
        { id: 'account_id', type: 'string', title: '账户 ID' },
        { id: 'plan_id', type: 'string', title: '套餐 ID' },
        { id: 'start_date', type: 'string', title: '开始日期' },
        { id: 'status', type: 'string', title: '状态' },
        { id: 'will_churn', type: 'integer', title: '是否流失' },
      ], status: 'approved',
    },
    {
      id: 'Employee', displayName: '员工', description: '集团员工',
      backingSource: 'employees.csv',
      properties: [
        { id: 'employee_id', type: 'string', title: '员工 ID', primaryKey: true },
        { id: 'name', type: 'string', title: '姓名' },
        { id: 'department_id', type: 'string', title: '部门 ID' },
        { id: 'position_id', type: 'string', title: '岗位 ID' },
        { id: 'subsidiary', type: 'string', title: '板块' },
        { id: 'hire_date', type: 'string', title: '入职日期' },
        { id: 'salary', type: 'number', title: '薪资' },
        { id: 'email', type: 'string', title: '邮箱' },
        { id: 'status', type: 'string', title: '状态' },
      ], status: 'approved',
    },
    {
      id: 'ProductionBatch', displayName: '生产批次', description: '制造生产批次',
      backingSource: 'production_batches.csv',
      properties: [
        { id: 'batch_id', type: 'string', title: '批次 ID', primaryKey: true },
        { id: 'order_id', type: 'string', title: '工单 ID' },
        { id: 'material_id', type: 'string', title: '物料 ID' },
        { id: 'start_date', type: 'string', title: '开始日期' },
        { id: 'output_qty', type: 'integer', title: '产出数量' },
      ], status: 'approved',
    },
  ],
};

const LINKS = {
  links: [
    { id: 'Customer_orders', source: 'Customer', target: 'RetailOrder', cardinality: '1:N', status: 'approved' },
    { id: 'Order_items', source: 'RetailOrder', target: 'Product', cardinality: 'N:M', status: 'approved' },
    { id: 'Supplier_products', source: 'Supplier', target: 'Product', cardinality: '1:N', status: 'approved' },
    { id: 'Customer_subscriptions', source: 'Customer', target: 'Subscription', cardinality: '1:N', status: 'approved' },
    { id: 'MfgProduct_batches', source: 'MfgProduct', target: 'ProductionBatch', cardinality: '1:N', status: 'approved' },
  ],
};

// 转换规则（列名与生成表一致；日期/金额/状态脏数据清洗演示，含链式）
const TRANSFORMS = {
  transforms: [
    {
      id: 'date_md_to_iso', source: 'attendance.csv', target: '日期格式统一（描述性）',
      type: 'regex_replace', rule: { pattern: '(\\d{2})/(\\d{2})/(\\d{4})', replacement: '$3-$1-$2', column: 'date' },
      description: 'MM/DD/YYYY → YYYY-MM-DD', status: 'approved',
    },
    {
      id: 'date_dmy_to_iso', source: 'attendance.csv', target: '日期格式统一（描述性）',
      type: 'regex_replace', rule: { pattern: '(\\d{2})-(\\d{2})-(\\d{4})', replacement: '$3-$2-$1', column: 'date' },
      description: 'DD-MM-YYYY → YYYY-MM-DD（$3-$2-$1 保持月日语义；与 MM/DD 规则 pattern 互斥，顺序无关）', status: 'approved',
    },
    {
      id: 'money_strip_symbols', source: 'salary_records.csv', target: '金额清洗（描述性）',
      type: 'regex_replace', rule: { pattern: '[$,]', replacement: '', column: 'base_salary' },
      description: '去货币符与千分位', status: 'approved',
    },
    {
      id: 'money_cast_number', source: 'salary_records.csv', target: '金额规范化（描述性）',
      type: 'cast', rule: { column: 'base_salary', targetType: 'number' },
      description: '链式：cast 上一条清洗后的金额', status: 'approved',
    },
    {
      id: 'email_lower_retail', source: 'customers_retail.csv', target: '邮箱小写（描述性）',
      type: 'lower', rule: { column: 'email' }, description: '邮箱统一小写', status: 'approved',
    },
    {
      id: 'company_trim', source: 'customers_retail.csv', target: '公司名清洗（描述性）',
      type: 'trim', rule: { column: 'company_name' }, description: '去首尾空白', status: 'approved',
    },
    {
      id: 'sku_normalize', source: 'products_retail.csv', target: 'SKU 规范化（描述性）',
      type: 'regex_replace', rule: { pattern: '^REF-', replacement: 'SKU-', column: 'product_id' },
      description: 'REF 前缀转 SKU', status: 'approved',
    },
    {
      id: 'payment_money_clean', source: 'payments.csv', target: '金额清洗（描述性）',
      type: 'regex_replace', rule: { pattern: '[$,]', replacement: '', column: 'amount' },
      description: '去货币符与千分位', status: 'approved',
    },
    {
      id: 'status_map_orders', source: 'orders_retail.csv', target: '状态归一（描述性）',
      type: 'map', rule: { mappings: { ACTIVE: 'active', ' Active ': 'active', CLOSED: 'closed', PENDING: 'pending' }, column: 'status' },
      description: '状态枚举归一', status: 'approved',
    },
    {
      id: 'status_map_mfg', source: 'production_orders.csv', target: '状态归一（描述性）',
      type: 'map', rule: { mappings: { OPEN: 'open', RELEASED: 'released', COMPLETED: 'completed' }, column: 'status' },
      description: '状态枚举归一', status: 'approved',
    },
    {
      id: 'qty_abs', source: 'order_items.csv', target: '负数量修正（描述性）',
      type: 'map', rule: { mappings: { '-1': '1', '-2': '2', '-3': '3', '-4': '4', '-5': '5' }, column: 'quantity' },
      description: '负数量转正', status: 'approved',
    },
    {
      id: 'bom_unit_extract', source: 'bills_of_materials.csv', target: 'BOM 用量数字提取（描述性）',
      type: 'regex_replace', rule: { pattern: '^([\\d.]+).*$', replacement: '$1', column: 'quantity_per_unit' },
      description: '“0.5 kg” → “0.5”', status: 'approved',
    },
    {
      id: 'email_lower_saas', source: 'customers_saas.csv', target: '邮箱小写（描述性）',
      type: 'lower', rule: { column: 'email' }, description: '邮箱统一小写', status: 'approved',
    },
    {
      id: 'level_map', source: 'memberships.csv', target: '会员等级归一（描述性）',
      type: 'map', rule: { mappings: { GOLD: 'gold', Gold: 'gold', SILVER: 'silver' }, column: 'level' },
      description: '等级枚举归一', status: 'approved',
    },
    {
      id: 'batch_id_normalize', source: 'production_batches.csv', target: '批次号规范化（描述性）',
      type: 'regex_replace', rule: { pattern: '^BATCH-(\\d+)$', replacement: 'B-$1', column: 'batch_id' },
      description: '批次号前缀统一', status: 'approved',
    },
    {
      id: 'active_orders_only', source: 'orders_retail.csv', target: '活跃订单过滤（描述性）',
      type: 'filter', rule: { condition: { column: 'status', op: 'eq', value: 'active' } },
      description: '只保留 active 订单', status: 'approved',
    },
  ],
};

// 合并规则（跨源实体消解，spec §6）：value 与生成器种子一致
// 客户：retail CUST-{i+1} / mfg MC-{i+1} / saas SC-{i+1}；供应商 SR-{i} / SM-{i}
const MERGES = {
  merges: [
    // 零售 ↔ SaaS（8 对）
    { id: 'merge_cust_rs_1', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-1' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-1' }, confidence: 0.95, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rs_2', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-2' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-2' }, confidence: 0.93, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rs_3', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-3' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-3' }, confidence: 0.91, rationale: '名称相似', status: 'approved' },
    { id: 'merge_cust_rs_4', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-4' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-4' }, confidence: 0.97, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rs_5', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-5' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-5' }, confidence: 0.94, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rs_6', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-6' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-6' }, confidence: 0.92, rationale: '名称相似', status: 'approved' },
    { id: 'merge_cust_rs_7', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-7' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-7' }, confidence: 0.96, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rs_8', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-8' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-8' }, confidence: 0.90, rationale: '名称相似', status: 'approved' },
    // 零售 ↔ 制造（4 对）
    { id: 'merge_cust_rm_1', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-111' }, right: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-111' }, confidence: 0.95, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rm_2', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-112' }, right: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-112' }, confidence: 0.93, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_rm_3', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-113' }, right: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-113' }, confidence: 0.91, rationale: '名称相似', status: 'approved' },
    { id: 'merge_cust_rm_4', left: { source: 'customers_retail.csv', key: 'customer_id', value: 'CUST-114' }, right: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-114' }, confidence: 0.94, rationale: '邮箱一致', status: 'approved' },
    // 制造 ↔ SaaS（4 对）
    { id: 'merge_cust_ms_1', left: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-1' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-1' }, confidence: 0.92, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_ms_2', left: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-2' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-2' }, confidence: 0.90, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_ms_3', left: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-3' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-3' }, confidence: 0.95, rationale: '邮箱一致', status: 'approved' },
    { id: 'merge_cust_ms_4', left: { source: 'customers_mfg.csv', key: 'customer_id', value: 'MC-4' }, right: { source: 'customers_saas.csv', key: 'customer_id', value: 'SC-4' }, confidence: 0.93, rationale: '邮箱一致', status: 'approved' },
    // 供应商：零售 ↔ 制造（4 对）
    { id: 'merge_sup_1', left: { source: 'suppliers_retail.csv', key: 'supplier_id', value: 'SR-1' }, right: { source: 'suppliers_mfg.csv', key: 'supplier_id', value: 'SM-1' }, confidence: 0.96, rationale: '名称一致', status: 'approved' },
    { id: 'merge_sup_2', left: { source: 'suppliers_retail.csv', key: 'supplier_id', value: 'SR-2' }, right: { source: 'suppliers_mfg.csv', key: 'supplier_id', value: 'SM-2' }, confidence: 0.94, rationale: '名称一致', status: 'approved' },
    { id: 'merge_sup_3', left: { source: 'suppliers_retail.csv', key: 'supplier_id', value: 'SR-3' }, right: { source: 'suppliers_mfg.csv', key: 'supplier_id', value: 'SM-3' }, confidence: 0.95, rationale: '名称一致', status: 'approved' },
    { id: 'merge_sup_4', left: { source: 'suppliers_retail.csv', key: 'supplier_id', value: 'SR-4' }, right: { source: 'suppliers_mfg.csv', key: 'supplier_id', value: 'SM-4' }, confidence: 0.93, rationale: '名称一致', status: 'approved' },
  ],
};

module.exports = { OBJECTS, LINKS, TRANSFORMS, MERGES };
