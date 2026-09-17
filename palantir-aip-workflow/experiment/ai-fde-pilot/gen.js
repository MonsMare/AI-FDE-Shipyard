// AI-FDE 实验数据集生成器（合成真实形态：三系统 + 脏格式 + 跨源重复 + 业务信号）
// 用法: node gen.js <输出目录> [seed]
// 固定种子保证可复现；设计埋点写入 <输出目录>/../ground-truth.json（供评估用）
'use strict';
const fs = require('fs');
const path = require('path');

// ---- 确定性随机 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANY = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Hooli', 'PiedPiper', 'Aperture', 'BlackMesa', 'Cyberdyne', 'Tyrell', 'Weyland', 'Yutani', 'Oscorp', 'Dunder Mifflin', 'Vandelay', 'Bluth', 'Prestige', 'Hooli'];

const FIRST = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑'];
const LAST = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平'];
const DOMAINS = ['gmail.com', 'outlook.com', '163.com', 'qq.com', 'company.cn', 'corp.com'];

function esc(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvRow(arr) { return arr.map(esc).join(','); }

// ---- 脏格式工厂 ----
function dirtyDate(rng) {
  const y = 2020 + Math.floor(rng() * 5), m = 1 + Math.floor(rng() * 12), d = 1 + Math.floor(rng() * 28);
  const p = rng();
  if (p < 0.55) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; // ISO
  if (p < 0.8) return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;    // MM/DD/YYYY
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;                 // DD-MM-YYYY
}
function dirtyMoney(rng, v) {
  const p = rng();
  if (p < 0.5) return String(Math.round(v * 100) / 100);                       // 纯数字
  if (p < 0.8) return '$' + Math.round(v).toLocaleString('en-US');             // $1,234
  return String(Math.round(v * 100) / 100).replace('.', ',');                  // 1234,56 逗号小数
}
function dirtyName(s, rng) {
  const p = rng();
  if (p < 0.35) return '  ' + s + ' ';   // 首尾空白
  if (p < 0.6) return s.toUpperCase();   // 全大写
  return s;
}

// ---- 埋点设计 ----
// 三个系统共享一个"真实实体空间"：每个实体有 canonical key（C-<n>）
// crm 用 CRM-<n> 键；saas 用 SAAS-<n>；mfg 用 MFG-<n>。跨源重复 = 同一 canonical 出现于两系统。
function main() {
  const outDir = process.argv[2];
  const seed = process.argv[3] ? Number(process.argv[3]) : 20260808;
  if (!outDir) { console.error('用法: node gen.js <输出目录> [seed]'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const rng = mulberry32(seed);

  const N_CRM = 1200, N_SAAS = 400, N_MFG = 200;
  const CRM_DUP = 120, MFG_DUP = 40; // 与 saas/mfg 重复的 crm 客户数

  // 真实实体空间
  const entities = [];
  for (let i = 0; i < N_CRM; i++) {
    const co = COMPANY[Math.floor(rng() * COMPANY.length)];
    const person = FIRST[Math.floor(rng() * FIRST.length)] + LAST[Math.floor(rng() * LAST.length)];
    entities.push({
      canonical: 'C-' + (i + 1),
      name: rng() < 0.5 ? co + ' ' + person : person + ' ' + co,
      email: (co + i + '@' + DOMAINS[Math.floor(rng() * DOMAINS.length)]).toLowerCase().replace(/\s+/g, ''),
      phone: '1' + String(1000000000 + Math.floor(rng() * 8999999999)),
      country: ['CN', 'US', 'DE', 'JP', 'SG'][Math.floor(rng() * 5)],
    });
  }

  // 客户分组：saas 账户 = 部分 crm 客户 + 独立客户
  const saasIds = []; // {canonical, id}
  const saasOfCrm = new Set();
  for (let i = 0; i < N_SAAS; i++) {
    const canon = i < CRM_DUP ? entities[i].canonical : null; // 前 CRM_DUP 个与 crm 重复
    if (canon) saasOfCrm.add(canon);
    saasIds.push({ canonical: canon, id: 'SAAS-' + (i + 1) });
  }
  const mfgIds = []; // 供应商
  const mfgOfCrm = new Set();
  for (let i = 0; i < N_MFG; i++) {
    const canon = i < MFG_DUP ? entities[i].canonical : null;
    if (canon) mfgOfCrm.add(canon);
    mfgIds.push({ canonical: canon, id: 'MFG-' + (i + 1) });
  }

  // ---- 1. crm_customers.csv（含脏名称/日期/电话；sector 列）----
  const crmRows = [['customer_id', 'company_name', 'contact_person', 'email', 'phone', 'country', 'created_date', 'segment']];
  for (let i = 0; i < N_CRM; i++) {
    const e = entities[i];
    crmRows.push([`CRM-${i + 1}`, dirtyName(e.name, rng), e.contact_person = FIRST[Math.floor(rng() * FIRST.length)] + LAST[Math.floor(rng() * LAST.length)], e.email, e.phone, e.country, dirtyDate(rng), ['A', 'B', 'C', 'SMB'][Math.floor(rng() * 4)]]);
  }
  // ---- 2. saas_accounts.csv（与 crm 重复的账户用相同 email 但名称变体/大小写不同）----
  const saasRows = [['account_id', 'account_name', 'account_email', 'billing_country', 'signup_date', 'plan']];
  const saasEmailToCanon = {};
  for (let i = 0; i < N_SAAS; i++) {
    const s = saasIds[i];
    const e = s.canonical ? entities.find(x => x.canonical === s.canonical) : {
      canonical: null,
      name: COMPANY[Math.floor(rng() * COMPANY.length)] + ' ' + FIRST[Math.floor(rng() * FIRST.length)] + LAST[Math.floor(rng() * LAST.length)],
      email: 'saas' + i + '@' + DOMAINS[Math.floor(rng() * DOMAINS.length)],
    };
    const nameVariant = s.canonical
      ? (rng() < 0.5 ? e.name.toLowerCase().replace(/\s+/g, '') : e.name.toUpperCase())
      : dirtyName(e.name, rng);
    saasRows.push([s.id, nameVariant, e.email, e.country || 'US', dirtyDate(rng), ['basic', 'pro', 'enterprise'][Math.floor(rng() * 3)]]);
    if (s.canonical) saasEmailToCanon[e.email] = s.canonical;
  }
  // ---- 3. saas_subscriptions.csv（引用 account_id；含负数量信号 ~6%）----
  const subRows = [['subscription_id', 'account_id', 'product', 'quantity', 'unit_price', 'start_date', 'end_date', 'status']];
  for (let i = 0; i < 3000; i++) {
    const acct = saasIds[Math.floor(rng() * saasIds.length)];
    const qty = rng() < 0.06 ? -Math.ceil(rng() * 9) : 1 + Math.floor(rng() * 50); // 6% 负数量（退款差错信号）
    subRows.push([`SUB-${i + 1}`, acct.id, ['platform', 'modules', 'support', 'api'][Math.floor(rng() * 4)], String(qty), dirtyMoney(rng, 10 + rng() * 500), dirtyDate(rng), dirtyDate(rng), ['active', 'active', 'active', 'cancelled', 'past_due'][Math.floor(rng() * 5)]]);
  }
  // ---- 4. mfg_suppliers.csv（与 crm 重复的供应商名变体）----
  const mfgRows = [['supplier_id', 'supplier_name', 'supplier_email', 'location', 'since_date', 'rating']];
  for (let i = 0; i < N_MFG; i++) {
    const s = mfgIds[i];
    const e = s.canonical ? entities.find(x => x.canonical === s.canonical) : {
      canonical: null,
      name: COMPANY[Math.floor(rng() * COMPANY.length)] + ' Industries',
      email: 'mfg' + i + '@' + DOMAINS[Math.floor(rng() * DOMAINS.length)],
    };
    const nameVariant = s.canonical ? (rng() < 0.5 ? e.name.replace(/\s+/g, '') : 'MFG ' + e.name) : dirtyName(e.name, rng);
    mfgRows.push([s.id, nameVariant, e.email, e.country || 'CN', dirtyDate(rng), Math.floor(rng() * 5) + 1]);
  }
  // ---- 5. mfg_shipments.csv（引用 supplier_id；lead_time 列 10% > 30 天延迟信号）----
  const shipRows = [['shipment_id', 'supplier_id', 'part_number', 'quantity', 'unit_cost', 'order_date', 'arrival_date', 'lead_time_days']];
  for (let i = 0; i < 2000; i++) {
    const sup = mfgIds[Math.floor(rng() * mfgIds.length)];
    const lead = rng() < 0.1 ? 31 + Math.floor(rng() * 40) : 1 + Math.floor(rng() * 30);
    shipRows.push([`SHIP-${i + 1}`, sup.id, 'PN-' + String(1000 + Math.floor(rng() * 9000)), String(1 + Math.floor(rng() * 200)), dirtyMoney(rng, 1 + rng() * 100), dirtyDate(rng), dirtyDate(rng), String(lead)]);
  }

  const files = {
    'crm_customers.csv': crmRows,
    'saas_accounts.csv': saasRows,
    'saas_subscriptions.csv': subRows,
    'mfg_suppliers.csv': mfgRows,
    'mfg_shipments.csv': shipRows,
  };
  for (const [name, rows] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), rows.map(csvRow).join('\n') + '\n', 'utf8');
  }

  // 埋点（ground truth）：供评估脚本核对 ER 覆盖率 / 引用命中率 / 信号保留
  const groundTruth = {
    seed,
    entities: N_CRM,
    crmDupWithSaas: [...saasOfCrm],   // canonical 集合（前 CRM_DUP 个）
    crmDupWithMfg: [...mfgOfCrm],
    saasDupCount: CRM_DUP,
    mfgDupCount: MFG_DUP,
    saasEmailToCanon: saasEmailToCanon,
    expectedNegQty: subRows.slice(1).filter(r => Number(r[3]) < 0).length,
    expectedLeadOver30: shipRows.slice(1).filter(r => Number(r[7]) > 30).length,
    totalSubs: 3000,
    totalShip: 2000,
    totalCrm: N_CRM,
    totalSaas: N_SAAS,
    totalMfg: N_MFG,
  };
  const gtPath = path.join(outDir, '..', 'ground-truth.json');
  fs.writeFileSync(gtPath, JSON.stringify(groundTruth, null, 2), 'utf8');
  console.log(`生成完成: ${outDir}`);
  console.log(`  crm=${N_CRM} saas=${N_SAAS} mfg=${N_MFG} subs=${groundTruth.totalSubs} ship=${groundTruth.totalShip}`);
  console.log(`  埋点: crm↔saas 重复 ${CRM_DUP} 对, crm↔mfg 重复 ${MFG_DUP} 对, 负数量 ${groundTruth.expectedNegQty} 行, 延迟>30天 ${groundTruth.expectedLeadOver30} 行`);
  console.log(`  ground truth: ${gtPath}`);
}
main();
