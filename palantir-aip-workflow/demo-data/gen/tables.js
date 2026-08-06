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
];

module.exports = { TABLES, buildDuplicateCustomers, SUPPLIER_NAMES, mulberry32 };
