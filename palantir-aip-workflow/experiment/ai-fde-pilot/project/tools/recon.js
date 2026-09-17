// recon.js — AI-FDE 侦察脚本：统计脏格式、业务信号、确定性 ER 候选配对
// 用法: node tools/recon.js（在 project/ 目录下运行）
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

function loadCsv(p) {
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  function parseLine(l) {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inQ) {
        if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }
  return lines.map(parseLine);
}

function table(name) {
  const rows = loadCsv(path.join(DATA, name));
  const head = rows[0];
  const data = rows.slice(1);
  const cols = {};
  head.forEach((c, i) => { cols[c] = i; });
  return { name, head, cols, data, rows: data.length };
}

function dist(rows, idx) {
  const m = new Map();
  for (const r of rows) {
    const v = r[idx] === undefined ? '' : r[idx].trim();
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

const crm = table('crm_customers.csv');
const saas = table('saas_accounts.csv');
const subs = table('saas_subscriptions.csv');
const mfg = table('mfg_suppliers.csv');
const ship = table('mfg_shipments.csv');

console.log('=== 行数 ===');
for (const t of [crm, saas, subs, mfg, ship]) console.log(`${t.name}: ${t.rows} 行, 列=${t.head.join(',')}`);

// ---- 主键唯一 ----
console.log('\n=== 主键唯一性 ===');
for (const [t, key] of [[crm, 'customer_id'], [saas, 'account_id'], [subs, 'subscription_id'], [mfg, 'supplier_id'], [ship, 'shipment_id']]) {
  const m = dist(t.data, t.cols[key]);
  const dup = [...m.entries()].filter(([, n]) => n > 1);
  console.log(`${t.name}.${key}: 唯一=${m.size === t.rows}, 重复=${dup.length} ${dup.slice(0, 3).map((d) => d.join('x')).join(', ')}`);
}

// ---- 日期格式分布 ----
console.log('\n=== 日期格式分布 ===');
const dateCols = [['crm_customers.csv', 'created_date'], ['saas_accounts.csv', 'signup_date'], ['saas_subscriptions.csv', 'start_date'], ['saas_subscriptions.csv', 'end_date'], ['mfg_suppliers.csv', 'since_date'], ['mfg_shipments.csv', 'order_date'], ['mfg_shipments.csv', 'arrival_date']];
const DATE_RE = [
  ['ISO', /^\d{4}-\d{2}-\d{2}$/],
  ['MM/DD/YYYY', /^\d{1,2}\/\d{1,2}\/\d{4}$/],
  ['DD-MM-YYYY', /^\d{1,2}-\d{1,2}-\d{4}$/],
];
for (const [f, col] of dateCols) {
  const t = table(f);
  const m = new Map();
  let other = 0;
  const otherSamples = new Set();
  for (const r of t.data) {
    const v = r[t.cols[col]].trim();
    const hit = DATE_RE.find(([, re]) => re.test(v));
    if (hit) m.set(hit[0], (m.get(hit[0]) || 0) + 1);
    else { other++; if (otherSamples.size < 5) otherSamples.add(v || '(空)'); }
  }
  console.log(`${f}.${col}: ${[...m.entries()].map(([k, n]) => `${k}=${n}`).join(' ')} 其他=${other} ${other ? [...otherSamples].join(' | ') : ''}`);
}

// ---- 金额格式分布 ----
console.log('\n=== 金额格式分布 ===');
const moneyCols = [['saas_subscriptions.csv', 'unit_price'], ['mfg_shipments.csv', 'unit_cost']];
for (const [f, col] of moneyCols) {
  const t = table(f);
  const m = new Map();
  let bad = 0;
  const badSamples = new Set();
  for (const r of t.data) {
    const v = r[t.cols[col]].trim();
    let k;
    if (/^-\$/.test(v)) k = '-$前缀';
    else if (/^\$/.test(v)) k = '$前缀';
    else if (/^[\d.]+,[\d.]+$/.test(v)) k = '逗号小数';
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) k = '千分位';
    else if (/^-?\d{1,3}( \d{3})+(\.\d+)?$/.test(v)) k = '空格千分位';
    else if (/^-?\d*\.?\d+$/.test(v)) k = '纯数字';
    else k = '其他';
    m.set(k, (m.get(k) || 0) + 1);
    if (k === '其他') { bad++; if (badSamples.size < 5) badSamples.add(v || '(空)'); }
  }
  console.log(`${f}.${col}: ${[...m.entries()].map(([k, n]) => `${k}=${n}`).join(' ')} ${bad ? `其他样本: ${[...badSamples].join(' | ')}` : ''}`);
}

// ---- 数量/延迟 ----
console.log('\n=== 业务信号 ===');
{
  const neg = subs.data.filter((r) => Number(r[subs.cols.quantity]) < 0);
  console.log(`subscriptions.quantity<0: ${neg.length} 行（样本: ${neg.slice(0, 5).map((r) => r[subs.cols.quantity]).join(', ')}）`);
  const nonInt = subs.data.filter((r) => r[subs.cols.quantity].trim() !== '' && !/^-?\d+$/.test(r[subs.cols.quantity].trim()));
  console.log(`subscriptions.quantity 非整数: ${nonInt.length}（样本: ${nonInt.slice(0, 8).map((r) => r[subs.cols.quantity]).join(', ') || '无'}）`);
  const lat = ship.data.filter((r) => Number(r[ship.cols.lead_time_days]) > 30);
  console.log(`shipments.lead_time_days>30: ${lat.length} 行`);
  const nonIntL = ship.data.filter((r) => r[ship.cols.lead_time_days].trim() !== '' && !/^-?\d+$/.test(r[ship.cols.lead_time_days].trim()));
  console.log(`shipments.lead_time_days 非整数: ${nonIntL.length}（样本: ${nonIntL.slice(0, 5).map((r) => r[ship.cols.lead_time_days]).join(', ') || '无'}）`);
}

// ---- 确定性 ER 候选：规范化 email join ----
console.log('\n=== ER 候选（email trim+lower 精确匹配） ===');
const norm = (s) => String(s || '').trim().toLowerCase();
const crmEmail = new Map(crm.data.map((r) => [norm(r[crm.cols.email]), r[crm.cols.customer_id]]));
const saasEmail = new Map(saas.data.map((r) => [norm(r[saas.cols.account_email]), r[saas.cols.account_id]]));
const mfgEmail = new Map(mfg.data.map((r) => [norm(r[mfg.cols.supplier_email]), r[mfg.cols.supplier_id]]));

const crmDupEmail = crm.data.length - new Set(crm.data.map((r) => norm(r[crm.cols.email]))).size;
console.log(`CRM email 内部重复: ${crmDupEmail}，SAAS email 内部重复: ${saas.data.length - saasEmail.size}，MFG email 内部重复: ${mfg.data.length - mfgEmail.size}`);

const saasPairs = [];
for (const [em, sid] of saasEmail) {
  if (crmEmail.has(em)) saasPairs.push([crmEmail.get(em), sid, em]);
}
const mfgPairs = [];
for (const [em, mid] of mfgEmail) {
  if (crmEmail.has(em)) mfgPairs.push([crmEmail.get(em), mid, em]);
}
console.log(`SAAS→CRM 匹配对: ${saasPairs.length}`);
console.log(`MFG→CRM 匹配对: ${mfgPairs.length}`);
console.log(`合计: ${saasPairs.length + mfgPairs.length}`);
console.log('SAAS 对前 5:', saasPairs.slice(0, 5).map((p) => p.join('→')).join(' | '));
console.log('MFG 对前 5:', mfgPairs.slice(0, 5).map((p) => p.join('→')).join(' | '));

// 保存配对供 entity 步骤使用
const out = {
  saasPairs: saasPairs.map(([l, r, e]) => ({ left: l, right: r, email: e })),
  mfgPairs: mfgPairs.map(([l, r, e]) => ({ left: l, right: r, email: e })),
};
fs.writeFileSync(path.join(__dirname, 'er-pairs.json'), JSON.stringify(out, null, 2));
console.log(`\n已写入 tools/er-pairs.json（${saasPairs.length + mfgPairs.length} 对）`);
