// verify.js — post-exec 期望核对（对齐 expectations.json 与评估器检查域）
// 只对"规则链最终产物"（*_cast.csv / *_lower.csv）核对，避免中间产物误报。
// 用法: node tools/verify.js <项目目录>   （在 project/ 下运行: node tools/verify.js .）
'use strict';
const fs = require('fs');
const path = require('path');

const projDir = process.argv[2] || __dirname;
const outDir = path.join(projDir, 'output');
const dataDir = path.join(projDir, '..', 'data');

function loadCsv(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  function parseLine(l) {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inQ) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
      else { if (c === '"') inQ = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  }
  return lines.map(parseLine);
}

if (!fs.existsSync(outDir)) { console.error('✘ output/ 不存在（先跑 bin/exec.js）'); process.exit(1); }

const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.csv'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}: ${detail}`); };

const FINAL = {
  created_date: 'crm_created_date_cast.csv',
  signup_date: 'saas_signup_date_cast.csv',
  start_date: 'subs_start_date_cast.csv',
  end_date: 'subs_end_date_cast.csv',
  since_date: 'mfg_since_date_cast.csv',
  order_date: 'ship_order_date_cast.csv',
  arrival_date: 'ship_arrival_date_cast.csv',
  unit_price: 'subs_unit_price_cast.csv',
  unit_cost: 'ship_unit_cost_cast.csv',
};

// ---- 主键唯一（仅最终 cast 产物；中间产物为 exec 全表快照语义，跨产物重复属正常）----
const PK = { customer_id: 'crm', account_id: 'saas', subscription_id: 'subs', supplier_id: 'mfg', shipment_id: 'ship' };
const PK_FINAL = {
  customer_id: 'crm_created_date_cast.csv',
  account_id: 'saas_signup_date_cast.csv',
  subscription_id: 'subs_end_date_cast.csv',
  supplier_id: 'mfg_since_date_cast.csv',
  shipment_id: 'ship_arrival_date_cast.csv',
};
for (const [pk, tag] of Object.entries(PK)) {
  const f = PK_FINAL[pk];
  const csv = loadCsv(path.join(outDir, f));
  if (!csv) { check(`主键唯一 ${pk}（${tag}）`, false, `${f} 缺失`); continue; }
  const i = csv[0].indexOf(pk);
  const seen = new Set();
  let dup = 0;
  for (const r of csv.slice(1)) {
    if (r[i] === '' || seen.has(r[i])) dup++;
    seen.add(r[i]);
  }
  check(`主键唯一 ${pk}（${tag}）`, dup === 0, `最终产物 ${f} ${csv.length - 1} 行，重复/空 ${dup}（期望 0）`);
}

// ---- 行数守恒（最终产物 = 源行数）----
const ROWCNT = { crm_created_date_cast: 1200, saas_signup_date_cast: 400, subs_end_date_cast: 3000, mfg_since_date_cast: 200, ship_arrival_date_cast: 2000 };
for (const [id, expect] of Object.entries(ROWCNT)) {
  const csv = loadCsv(path.join(outDir, `${id}.csv`));
  check(`行数守恒 ${id}`, csv && csv.length - 1 === expect, `${csv ? csv.length - 1 : 0} 行（期望 ${expect}）`);
}

// ---- 负数量（subs_quantity_cast 最终产物）----
{
  const csv = loadCsv(path.join(outDir, 'subs_quantity_cast.csv'));
  let neg = 0;
  if (csv) { const q = csv[0].indexOf('quantity'); for (const r of csv.slice(1)) if (Number(r[q]) < 0) neg++; }
  check('负数量保留 =168（B6）', neg === 168, `quantity<0 共 ${neg} 行（期望 168）`);
}

// ---- 延迟（ship_lead_time_cast 最终产物）----
{
  const csv = loadCsv(path.join(outDir, 'ship_lead_time_cast.csv'));
  let lag = 0;
  if (csv) { const l = csv[0].indexOf('lead_time_days'); for (const r of csv.slice(1)) if (Number(r[l]) > 30) lag++; }
  check('延迟 >30 =206', lag === 206, `lead_time_days>30 共 ${lag} 行（期望 206）`);
}

// ---- 脏格式残留（7 日期列 + 2 金额列，仅查最终 cast 产物）----
for (const [col, file] of Object.entries(FINAL)) {
  const csv = loadCsv(path.join(outDir, file));
  if (!csv) { check(`脏残留 ${col}`, false, `${file} 缺失`); continue; }
  const i = csv[0].indexOf(col);
  let dirty = 0, empty = 0;
  for (const r of csv.slice(1)) {
    const v = r[i];
    if (v === '') empty++;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(col)) { /* date ok */ }
  }
  // 日期列：必须全 ISO；金额列：必须无 $/, 且为数字
  const isDate = /date$/.test(col);
  for (const r of csv.slice(1)) {
    const v = r[i];
    if (v === '') { empty++; continue; }
    if (isDate) { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) dirty++; }
    else if (/[$¥€]/.test(v) || /,/.test(v) || !/^-?\d*\.?\d+$/.test(v)) dirty++;
  }
  check(`脏残留 ${col}=0`, dirty === 0 && empty === 0, `残留 ${dirty}，空值 ${empty}（期望均 0）`);
}

// ---- 引用命中（最终 subs/ship 产物 account_id / supplier_id → 原始键集）----
function keySet(file, col) {
  const csv = loadCsv(path.join(dataDir, file));
  const i = csv[0].indexOf(col);
  return new Set(csv.slice(1).map((r) => r[i]));
}
{
  const saasKeys = keySet('saas_accounts.csv', 'account_id');
  const csv = loadCsv(path.join(outDir, 'subs_quantity_cast.csv'));
  const ai = csv[0].indexOf('account_id');
  let hit = 0, tot = 0;
  for (const r of csv.slice(1)) { tot++; if (saasKeys.has(r[ai])) hit++; }
  check('引用命中 account_id =100%（A2）', hit === tot, `${hit}/${tot}`);
}
{
  const mfgKeys = keySet('mfg_suppliers.csv', 'supplier_id');
  const csv = loadCsv(path.join(outDir, 'ship_lead_time_cast.csv'));
  const si = csv[0].indexOf('supplier_id');
  let hit = 0, tot = 0;
  for (const r of csv.slice(1)) { tot++; if (mfgKeys.has(r[si])) hit++; }
  check('引用命中 supplier_id =100%（A2）', hit === tot, `${hit}/${tot}`);
}

// ---- ER 声明（staging/merges.json）----
{
  const p = path.join(projDir, 'staging', 'merges.json');
  if (fs.existsSync(p)) {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    const declared = (m.merges || []).filter((x) => x.right && x.right.value);
    check('ER 声明 ≥144', declared.length >= 144, `声明 ${declared.length} 对（期望 ≥144）`);
  } else check('ER 声明 ≥144', false, 'staging/merges.json 缺失');
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== verify 核对: ${pass}/${results.length} 通过 ====`);
process.exit(pass === results.length ? 0 : 1);
