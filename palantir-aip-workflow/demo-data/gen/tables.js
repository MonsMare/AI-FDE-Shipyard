// tables.js — Meridian 控股集团数据集表定义（spec §3）
// 纯数据：列/规模/外键/脏数据规则。index.js 消费。
// 表对象：{ id, dir, rows, cols: [{name, gen(r, ctx)}], fks?: [{col, ref, key}], after?: (rows, ctx) }
'use strict';

// mulberry32 固定种子（与 index.js 一致）
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 名称池（确定性） ----------
const NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Karen', 'Leo', 'Mona', 'Nick', 'Olive', 'Paul', 'Quinn', 'Rose', 'Sam', 'Tina', 'Umar', 'Vera', 'Wendy', 'Xavier', 'Yuki', 'Zane', 'Chen', 'Liu', 'Wang', 'Zhang', 'Li', 'Zhao', 'Sun', 'Wu', 'Zhou', 'Wu', 'Xu', 'Hu', 'Guo', 'Lin'];
const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Co', 'Stark Industries', 'Wayne Enterprises', 'Wonka', 'Hooli', 'Pied Piper', 'Vandelay', 'Dunder Mifflin', 'Cyberdyne', 'Tyrell Corp', 'Weyland-Yutani', 'Aperture', 'Black Mesa', 'Blue Sun', 'Massive Dynamic', 'Oscorp', 'LexCorp'];
const SKU_PREFIX = ['SKU', 'R-', 'REF-', 'MD-'];
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州'];
const STATUS_DIRTY = ['active', 'ACTIVE', ' Active ', 'closed', 'CLOSED', 'pending', 'PENDING'];
const REASONS = ['主动离职', '被动优化', '合同到期', '退休', '裁员', '健康原因'];

// ---------- 跨源重复实体种子（spec §4.1） ----------
// 150 对客户：40 三表全在 + 70 零售∩SaaS + 40 零售∩制造
// 每项：baseEmail（规范小写，作为匹配键）、名称变体（各板块不同写法）
function buildDuplicateCustomers(rng) {
  const list = [];
  const mk = (i, inRetail, inMfg, inSaas) => {
    const comp = COMPANIES[Math.floor(rng() * COMPANIES.length)];
    const suffix = `-${100 + i}`;
    list.push({
      id: i,
      baseEmail: `acct${100 + i}@${['example.com', 'corp.net', 'biz.org'][i % 3]}`,
      variants: {
        retail: inRetail ? `${comp}${suffix}` : null,
        mfg: inMfg ? `${comp.toLowerCase()} ${suffix} inc` : null,
        saas: inSaas ? `${comp.toUpperCase()} (${suffix})` : null,
      },
    });
  };
  for (let i = 0; i < 40; i++) mk(i, true, true, true);        // 三表全在
  for (let i = 40; i < 110; i++) mk(i, true, false, true);      // 零售∩SaaS
  for (let i = 110; i < 150; i++) mk(i, true, true, false);     // 零售∩制造
  return list;
}

// 30 家供应商：零售∩制造（ID 不同）
const SUPPLIER_NAMES = ['华东金属', '珠江五金', '北方塑胶', '联科电子', '环球包装', '天成轴承', '湘江化工', '青岛部件', '中州电缆', '远东模具'];

const TABLES = [
  // ============ 集团层（10 表） ============
  {
    id: 'cost_centers', dir: 'group', rows: 60,
    cols: [
      { name: 'cost_center_id', gen: (r) => `CC-${r + 1}` },
      { name: 'name', gen: (r, ctx) => `${ctx.pick(CITIES)}${['工厂', '门店', '事业部', '研发', '客服', '仓储'][r % 6]}中心` },
      { name: 'subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'mfg', 'saas']) },
      { name: 'budget', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(500000, 50000000)) },
      { name: 'spent', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(300000, 48000000)) },
    ],
  },
  {
    id: 'departments', dir: 'group', rows: 40,
    cols: [
      { name: 'department_id', gen: (r) => `D-${r + 1}` },
      { name: 'name', gen: (r, ctx) => ctx.pick(['销售部', '市场部', '生产部', '研发部', '客服部', '财务部', '人事部', '仓储部', '采购部', '质检部']) },
      { name: 'subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'mfg', 'saas']) },
      { name: 'cost_center_id', gen: (r, ctx) => ctx.fk('cost_centers', 'cost_center_id') },
    ],
  },
  {
    id: 'positions', dir: 'group', rows: 120,
    cols: [
      { name: 'position_id', gen: (r) => `P-${r + 1}` },
      { name: 'title', gen: (r, ctx) => `${ctx.pick(['初级', '高级', '主管', '经理', '总监', 'VP'])}${ctx.pick(['工程师', '销售', '运营', '分析师', '顾问', '专员'])}` },
      { name: 'grade', gen: (r, ctx) => String(ctx.randInt(1, 9)) },
      { name: 'base_salary_range', gen: (r, ctx) => `${ctx.randInt(6, 15)}k-${ctx.randInt(16, 60)}k` },
    ],
  },
  {
    id: 'employees', dir: 'group', rows: 2600,
    cols: [
      { name: 'employee_id', gen: (r) => `E-${1001 + r}` },
      { name: 'name', gen: (r, ctx) => ctx.dirtyStr(`${ctx.pick(NAMES)} ${ctx.pick(NAMES)}`) },
      { name: 'department_id', gen: (r, ctx) => ctx.fk('departments', 'department_id') },
      { name: 'position_id', gen: (r, ctx) => ctx.fk('positions', 'position_id') },
      { name: 'subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'retail', 'retail', 'mfg', 'mfg', 'saas']) }, // 55/30/15
      { name: 'hire_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2015, 2026)) },
      { name: 'salary', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(5000, 60000)) },
      { name: 'email', gen: (r, ctx) => ctx.dirtyStr(`emp${1001 + r}@meridian.${ctx.pick(['com', 'COM', ' co'])}`) },
      { name: 'status', gen: (r, ctx) => (ctx.rng() < 0.154 ? 'left' : 'active') }, // 400/2600 离职
    ],
  },
  {
    id: 'employee_exits', dir: 'group', rows: 400,
    cols: [
      { name: 'employee_id', gen: (r, ctx) => ctx.fkWhere('employees', 'employee_id', (row) => row.status === 'left') },
      { name: 'exit_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'reason', gen: (r, ctx) => ctx.pick(REASONS) },
      { name: 'department_id', gen: (r, ctx) => ctx.fk('departments', 'department_id') },
    ],
  },
  {
    id: 'salary_records', dir: 'group', rows: 8000,
    cols: [
      { name: 'employee_id', gen: (r, ctx) => ctx.fk('employees', 'employee_id') },
      { name: 'month', gen: (r, ctx) => ctx.monthFmt() },
      { name: 'base_salary', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(5000, 60000)) },
      { name: 'bonus', gen: (r, ctx) => (ctx.rng() < 0.3 ? ctx.moneyFmt(ctx.randInt(1000, 30000)) : '0') },
      { name: 'deductions', gen: (r, ctx) => (ctx.rng() < 0.15 ? ctx.moneyFmt(ctx.randInt(100, 2000)) : '0') },
    ],
  },
  {
    id: 'attendance', dir: 'group', rows: 12000,
    cols: [
      { name: 'employee_id', gen: (r, ctx) => ctx.fk('employees', 'employee_id') },
      { name: 'date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
      { name: 'hours', gen: (r, ctx) => String(ctx.randInt(4, 12)) },
      { name: 'overtime', gen: (r, ctx) => (ctx.rng() < 0.2 ? String(ctx.randInt(1, 4)) : '0') },
      { name: 'status', gen: (r, ctx) => ctx.pick(STATUS_DIRTY) },
    ],
  },
  {
    id: 'performance_reviews', dir: 'group', rows: 5200,
    cols: [
      { name: 'employee_id', gen: (r, ctx) => ctx.fk('employees', 'employee_id') },
      { name: 'review_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'score', gen: (r, ctx) => ctx.pick(['4.5', '4', '3.5', '3', 'A', 'B', 'C', '2.5']) },
      { name: 'rating', gen: (r, ctx) => ctx.pick(['优秀', '良好', '合格', '需改进']) },
      { name: 'notes', gen: (r, ctx) => (ctx.rng() < 0.5 ? '表现稳定' : ctx.pick(['晋升候选', '需培训', '业绩突出', '沟通待加强'])) },
    ],
  },
  {
    id: 'group_finance', dir: 'group', rows: 72,
    cols: [
      { name: 'subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'mfg', 'saas']) },
      { name: 'month', gen: (r, ctx) => ctx.monthFmt() },
      { name: 'revenue', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(2000000, 30000000)) },
      { name: 'receivable', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(500000, 12000000)) },
      { name: 'days_sales_outstanding', gen: (r, ctx) => String(ctx.randInt(30, 120)) }, // 病症：mfg 90+ 由 after 注入
      { name: 'inventory_value', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(300000, 8000000)) },
      { name: 'headcount', gen: (r, ctx) => String(ctx.randInt(80, 1400)) },
    ],
    after: (rows) => {
      // 制造子公司 DSO 长期 90+（账期病症，spec §4.3-4）
      for (const row of rows) {
        if (row.subsidiary === 'mfg') row.days_sales_outstanding = String(90 + (parseInt(row.days_sales_outstanding, 10) % 45));
      }
    },
  },
  {
    id: 'intercompany_transactions', dir: 'group', rows: 200,
    cols: [
      { name: 'txn_id', gen: (r) => `IT-${r + 1}` },
      { name: 'from_subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'mfg', 'saas']) },
      { name: 'to_subsidiary', gen: (r, ctx) => ctx.pick(['retail', 'mfg', 'saas']) },
      { name: 'amount', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(10000, 2000000)) },
      { name: 'date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
      { name: 'description', gen: (r, ctx) => ctx.pick(['内部采购', '服务费分摊', '租金结算', 'IT 支持费', '物流费']) },
    ],
  },

  // ============ 零售板块（21 表） ============
  {
    id: 'suppliers_retail', dir: 'retail', rows: 80,
    cols: [
      { name: 'supplier_id', gen: (r) => `SR-${r + 1}` },
      { name: 'name', gen: (r, ctx) => SUPPLIER_NAMES[Math.floor(r / 10) % SUPPLIER_NAMES.length] },
      { name: 'region', gen: (r, ctx) => ctx.pick(CITIES) },
      { name: 'lead_time_days', gen: (r, ctx) => String(ctx.randInt(3, 45)) },
      { name: 'rating', gen: (r, ctx) => String(ctx.randInt(1, 5)) },
    ],
    // 前 30 行 = 跨源种子供应商（与制造共用，ID 不同；spec §4.1-2）
    seed: (ctx) => SUPPLIER_NAMES.map((n, i) => ({
      supplier_id: `SR-${i + 1}`, name: n, region: CITIES[i % CITIES.length],
      lead_time_days: String(5 + (i % 30)), rating: String(1 + (i % 5)),
    })),
  },
  {
    id: 'categories', dir: 'retail', rows: 30,
    cols: [
      { name: 'category_id', gen: (r) => `CAT-${r + 1}` },
      { name: 'name', gen: (r, ctx) => ctx.pick(['电子产品', '家居', '服饰', '食品', '运动', '美妆', '图书', '玩具']) },
      { name: 'parent_id', gen: (r, ctx) => (r < 6 ? '0' : `CAT-${ctx.randInt(1, 6)}`) },
    ],
  },
  {
    id: 'products_retail', dir: 'retail', rows: 800,
    cols: [
      { name: 'product_id', gen: (r, ctx) => `${ctx.pick(SKU_PREFIX)}${1000 + r}` },
      { name: 'name', gen: (r, ctx) => `${ctx.pick(['智能', '便携', '经典', '豪华', '标准', 'mini'])}${ctx.pick(['手机壳', '音箱', '耳机', '手表', '台灯', '背包', '水杯', '键盘'])}-${r % 50}` },
      { name: 'category_id', gen: (r, ctx) => ctx.fk('categories', 'category_id') },
      { name: 'supplier_id', gen: (r, ctx) => ctx.fk('suppliers_retail', 'supplier_id') },
      { name: 'unit_price', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(20, 5000)) },
    ],
  },
  {
    id: 'stores', dir: 'retail', rows: 25,
    cols: [
      { name: 'store_id', gen: (r) => `ST-${r + 1}` },
      { name: 'name', gen: (r, ctx) => `${ctx.pick(CITIES)}${['旗舰店', '标准店', '体验店'][r % 3]}` },
      { name: 'city', gen: (r, ctx) => ctx.pick(CITIES) },
      { name: 'region', gen: (r, ctx) => ctx.pick(['华东', '华南', '华北', '西南']) },
    ],
  },
  {
    id: 'customers_retail', dir: 'retail', rows: 5000,
    cols: [
      { name: 'customer_id', gen: (r) => `CUST-${r + 1}` },
      { name: 'company_name', gen: (r, ctx) => ctx.dirtyStr(`${ctx.pick(COMPANIES)} #${r % 97}`) },
      { name: 'email', gen: (r, ctx) => ctx.dirtyStr(`buyer${r}@${ctx.pick(['mail.com', 'corp.net', 'biz.org', 'example.com'])}`) },
      { name: 'phone', gen: (r, ctx) => `138-${String(ctx.randInt(1000, 9999))}-${String(ctx.randInt(1000, 9999))}` },
      { name: 'region', gen: (r, ctx) => ctx.pick(CITIES) },
      { name: 'signup_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2020, 2026)) },
    ],
    // 前 150 行 = 跨源种子客户零售变体（spec §4.1-1）
    seed: (ctx) => ctx.duplicates.customers.map((c) => ({
      customer_id: `CUST-${c.id + 1}`,
      company_name: c.variants.retail,
      email: c.id % 2 === 0 ? c.baseEmail : c.baseEmail.toUpperCase(),
      phone: `139-${String(1000 + c.id)}-000${c.id % 10}`,
      region: CITIES[c.id % CITIES.length],
      signup_date: `2020-${String(1 + (c.id % 12)).padStart(2, '0')}-15`,
    })),
  },
  {
    id: 'memberships', dir: 'retail', rows: 1200,
    cols: [
      { name: 'membership_id', gen: (r) => `M-${r + 1}` },
      { name: 'customer_id', gen: (r, ctx) => ctx.fk('customers_retail', 'customer_id') },
      { name: 'level', gen: (r, ctx) => ctx.pick(['gold', 'GOLD', 'Gold', 'silver', 'SILVER', 'bronze']) },
      { name: 'points', gen: (r, ctx) => String(ctx.randInt(0, 50000)) },
    ],
  },
  {
    id: 'price_history', dir: 'retail', rows: 3200,
    cols: [
      { name: 'price_id', gen: (r) => `PR-${r + 1}` },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'effective_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'price', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(15, 5200)) },
    ],
  },
  {
    id: 'inventory_retail', dir: 'retail', rows: 4000,
    cols: [
      { name: 'inventory_id', gen: (r) => `INV-${r + 1}` },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'store_id', gen: (r, ctx) => ctx.fk('stores', 'store_id') },
      { name: 'stock', gen: (r, ctx) => String(ctx.randInt(0, 500)) },
      { name: 'reorder_level', gen: (r, ctx) => String(ctx.randInt(10, 100)) },
      { name: 'last_updated', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
    ],
    after: (rows) => {
      // 库存积压病症（spec §4.3-1）：8% 记录 stock 极端积压（确定性：固定间隔取行）
      const count = Math.floor(rows.length * 0.08);
      for (let i = 0; i < count; i++) rows[i * 7 % rows.length].stock = String(8000 + (i * 137 % 9000));
    },
  },
  {
    id: 'coupons', dir: 'retail', rows: 200,
    cols: [
      { name: 'coupon_id', gen: (r) => `CP-${r + 1}` },
      { name: 'code', gen: (r) => `SAVE${1000 + r}` },
      { name: 'discount_rate', gen: (r, ctx) => ctx.pick(['0.2', '20%', '0.15', '10%', '0.3']) },
      { name: 'expires', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2026, 2026)) },
    ],
  },
  {
    id: 'campaigns', dir: 'retail', rows: 60,
    cols: [
      { name: 'campaign_id', gen: (r) => `CM-${r + 1}` },
      { name: 'name', gen: (r, ctx) => `${ctx.pick(['双十一', '618', '年货节', '新品首发', '清仓'])}-${r + 1}` },
      { name: 'channel', gen: (r, ctx) => ctx.pick(['线上', '门店', '直播', '社交媒体', '邮件']) },
      { name: 'cost', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(5000, 800000)) },
      { name: 'attributed_revenue', gen: (r, ctx) => (ctx.rng() < 0.3 ? ctx.moneyFmt(ctx.randInt(1000, 30000)) : ctx.moneyFmt(ctx.randInt(50000, 3000000))) },
      { name: 'start_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
      { name: 'end_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
    ],
  },
  {
    id: 'orders_retail', dir: 'retail', rows: 15000,
    cols: [
      { name: 'order_id', gen: (r) => `ORD-${r + 1}` },
      { name: 'customer_id', gen: (r, ctx) => ctx.fk('customers_retail', 'customer_id') },
      { name: 'store_id', gen: (r, ctx) => ctx.fk('stores', 'store_id') },
      { name: 'coupon_id', gen: (r, ctx) => (ctx.rng() < 0.3 ? ctx.fk('coupons', 'coupon_id') : '') },
      { name: 'order_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'status', gen: (r, ctx) => ctx.pick(STATUS_DIRTY) },
      { name: 'total_amount', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(50, 20000)) },
    ],
    after: (rows) => {
      // 孤儿外键病症（spec §4.2）：1% 订单指向不存在客户
      const orphanCount = Math.floor(rows.length * 0.01);
      for (let i = 0; i < orphanCount; i++) rows[(i * 13) % rows.length].customer_id = 'CUST-99999';
    },
  },
  {
    id: 'order_items', dir: 'retail', rows: 45000,
    cols: [
      { name: 'item_id', gen: (r) => `OI-${r + 1}` },
      { name: 'order_id', gen: (r, ctx) => ctx.fk('orders_retail', 'order_id') },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'quantity', gen: (r, ctx) => (ctx.rng() < 0.02 ? `-${ctx.randInt(1, 5)}` : String(ctx.randInt(1, 10))) }, // 负数量脏数据
      { name: 'unit_price', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(15, 5200)) },
      { name: 'subtotal', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(15, 50000)) },
    ],
  },
  {
    id: 'stock_movements', dir: 'retail', rows: 20000,
    cols: [
      { name: 'movement_id', gen: (r) => `MV-${r + 1}` },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'store_id', gen: (r, ctx) => ctx.fk('stores', 'store_id') },
      { name: 'quantity', gen: (r, ctx) => String(ctx.rng() < 0.5 ? ctx.randInt(1, 200) : -ctx.randInt(1, 200)) },
      { name: 'movement_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
      { name: 'type', gen: (r, ctx) => ctx.pick(['in', 'OUT', 'In', 'adjust', 'ADJUST']) },
    ],
  },
  {
    id: 'shipments', dir: 'retail', rows: 14000,
    cols: [
      { name: 'shipment_id', gen: (r) => `SH-${r + 1}` },
      { name: 'order_id', gen: (r, ctx) => ctx.fk('orders_retail', 'order_id') },
      { name: 'shipped_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'delivered_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'carrier', gen: (r, ctx) => ctx.pick(['顺丰', '圆通', '中通', '京东物流', '邮政']) },
      { name: 'delivery_days', gen: (r, ctx) => (ctx.rng() < 0.1 ? String(ctx.randInt(8, 30)) : String(ctx.randInt(1, 7))) }, // 10% 物流慢
    ],
  },
  {
    id: 'returns', dir: 'retail', rows: 1200,
    cols: [
      { name: 'return_id', gen: (r) => `RT-${r + 1}` },
      { name: 'order_id', gen: (r, ctx) => ctx.fk('orders_retail', 'order_id') },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'return_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'reason', gen: (r, ctx) => ctx.pick(['尺寸不符', '质量问题', '发错货', '不喜欢', '破损']) },
      { name: 'refund_amount', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(15, 5000)) },
    ],
  },
  {
    id: 'payments', dir: 'retail', rows: 15000,
    cols: [
      { name: 'payment_id', gen: (r) => `PAY-${r + 1}` },
      { name: 'order_id', gen: (r, ctx) => ctx.fk('orders_retail', 'order_id') },
      { name: 'amount', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(50, 20000)) },
      { name: 'method', gen: (r, ctx) => ctx.pick(['alipay', 'wechat', 'card', 'COD']) },
      { name: 'status', gen: (r, ctx) => (ctx.rng() < 0.05 ? 'failed' : ctx.pick(['success', 'SUCCESS', 'pending'])) }, // 5% 失败
      { name: 'paid_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
    ],
  },
  {
    id: 'campaign_redemptions', dir: 'retail', rows: 8000,
    cols: [
      { name: 'redemption_id', gen: (r) => `RD-${r + 1}` },
      { name: 'campaign_id', gen: (r, ctx) => ctx.fk('campaigns', 'campaign_id') },
      { name: 'coupon_id', gen: (r, ctx) => ctx.fk('coupons', 'coupon_id') },
      { name: 'customer_id', gen: (r, ctx) => ctx.fk('customers_retail', 'customer_id') },
      { name: 'redeemed_at', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
    ],
  },
  {
    id: 'reviews', dir: 'retail', rows: 3000,
    cols: [
      { name: 'review_id', gen: (r) => `RV-${r + 1}` },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'customer_id', gen: (r, ctx) => ctx.fk('customers_retail', 'customer_id') },
      { name: 'rating', gen: (r, ctx) => ctx.pick(['5', '4', '3', '2', '1', '★5', '★4']) },
      { name: 'comment', gen: (r, ctx) => (ctx.rng() < 0.5 ? '' : ctx.pick(['很好', '一般', '差评', '性价比高', '物流慢'])) },
      { name: 'review_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
    ],
  },
  {
    id: 'purchases_retail', dir: 'retail', rows: 1500,
    cols: [
      { name: 'purchase_id', gen: (r) => `PC-${r + 1}` },
      { name: 'supplier_id', gen: (r, ctx) => ctx.fk('suppliers_retail', 'supplier_id') },
      { name: 'order_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'arrival_date', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2024, 2026)) },
      { name: 'lead_time_days', gen: (r, ctx) => (ctx.rng() < 0.15 ? String(ctx.randInt(30, 90)) : String(ctx.randInt(2, 20))) }, // 交期病症
      { name: 'status', gen: (r, ctx) => ctx.pick(['received', 'RECEIVED', 'pending', 'overdue']) },
    ],
  },
  {
    id: 'purchase_items', dir: 'retail', rows: 6000,
    cols: [
      { name: 'purchase_item_id', gen: (r) => `PI-${r + 1}` },
      { name: 'purchase_id', gen: (r, ctx) => ctx.fk('purchases_retail', 'purchase_id') },
      { name: 'product_id', gen: (r, ctx) => ctx.fk('products_retail', 'product_id') },
      { name: 'quantity', gen: (r, ctx) => String(ctx.randInt(10, 2000)) },
      { name: 'unit_cost', gen: (r, ctx) => ctx.moneyFmt(ctx.randInt(5, 3000)) },
    ],
  },
  {
    id: 'service_tickets', dir: 'retail', rows: 2000,
    cols: [
      { name: 'ticket_id', gen: (r) => `TK-${r + 1}` },
      { name: 'customer_id', gen: (r, ctx) => ctx.fk('customers_retail', 'customer_id') },
      { name: 'subject', gen: (r, ctx) => ctx.pick(['退换货', '物流查询', '发票问题', '售后维修', '投诉']) },
      { name: 'status', gen: (r, ctx) => ctx.pick(['open', 'OPEN', 'closed', 'resolved', 'pending']) },
      { name: 'created_at', gen: (r, ctx) => ctx.dateFmt(ctx.randDate(2025, 2026)) },
      { name: 'closed_at', gen: (r, ctx) => (ctx.rng() < 0.2 ? '' : ctx.dateFmt(ctx.randDate(2025, 2026))) },
    ],
  },
];

module.exports = { TABLES, buildDuplicateCustomers, SUPPLIER_NAMES, mulberry32 };
