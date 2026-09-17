// gen-merges.js — 确定性生成 ER 合并声明（可复现 staging/merges.json）
// 方法：CRM/SaaS/MFG 三表按规范化 email（trim+lower）精确 join；CRM 为 canonical 左表。
// 用法: node tools/gen-merges.js            → 输出到 stdout
//       node tools/gen-merges.js --write    → 覆盖写入 staging/merges.json
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const STAGING = path.join(__dirname, '..', 'staging');

function loadCsv(p) {
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

function table(name) {
  const rows = loadCsv(path.join(DATA, name));
  const head = rows[0]; const data = rows.slice(1);
  const cols = {}; head.forEach((c, i) => { cols[c] = i; });
  return { name, head, cols, data };
}

const norm = (s) => String(s || '').trim().toLowerCase();

const crm = table('crm_customers.csv');
const saas = table('saas_accounts.csv');
const mfg = table('mfg_suppliers.csv');

const crmEmail = new Map(crm.data.map((r) => [norm(r[crm.cols.email]), r[crm.cols.customer_id]]));

const merges = [];
let n = 0;
const add = (left, right, rightSource, rightKey, tag) => {
  n++;
  const id = `merge-${tag}-${String(n).padStart(3, '0')}`;
  merges.push({
    id,
    left: { source: 'crm_customers.csv', key: 'customer_id', value: left },
    right: { source: rightSource, key: rightKey, value: right },
    confidence: 0.99,
    rationale: '规范化 email 完全一致（确定性匹配）',
    status: 'staged',
    proposedBy: 'paip-entity',
  });
};

// CRM ↔ SAAS：按 account_email
for (const r of saas.data) {
  const em = norm(r[saas.cols.account_email]);
  if (crmEmail.has(em)) add(crmEmail.get(em), r[saas.cols.account_id], 'saas_accounts.csv', 'account_id', 'saas');
}
// CRM ↔ MFG：按 supplier_email
for (const r of mfg.data) {
  const em = norm(r[mfg.cols.supplier_email]);
  if (crmEmail.has(em)) add(crmEmail.get(em), r[mfg.cols.supplier_id], 'mfg_suppliers.csv', 'supplier_id', 'mfg');
}

const out = {
  _note: '由 tools/gen-merges.js 确定性生成（email trim+lower 精确 join）',
  merges,
};

if (process.argv.includes('--write')) {
  fs.mkdirSync(STAGING, { recursive: true });
  fs.writeFileSync(path.join(STAGING, 'merges.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`已写入 staging/merges.json：${merges.length} 条声明`);
} else {
  console.log(JSON.stringify(out, null, 2));
}
console.log(`[gen-merges] 总声明数: ${merges.length}（CRM↔SAAS + CRM↔MFG）`);
