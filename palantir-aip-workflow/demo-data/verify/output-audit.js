// verify/output-audit.js — 交付结果可用性审计（企业优化视角）
// 在副本上跑 exec 全量，检查：产物完整性 / 数据质量 / 关联一致性 / 病症可见性
// 运行: node verify/output-audit.js <company-group 路径>
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const projectDir = process.argv[2] || path.join(__dirname, '..', 'company-group');
const { execProject } = require('../../bin/exec.js');
const { readCsvFile } = require('../../bin/csv.js');

const report = {};

// ---------- 0. 副本执行 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-audit-'));
fs.cpSync(projectDir, tmp, { recursive: true });
const r = execProject(tmp);
if (!r.ok) {
  console.log(JSON.stringify({ error: 'exec 失败', problems: r.problems }, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
const outDir = path.join(tmp, 'output');
const outFiles = fs.readdirSync(outDir).filter((f) => f.endsWith('.csv')).sort();
const csv = (name) => readCsvFile(path.join(outDir, name));
const raw = (rel) => readCsvFile(path.join(tmp, 'data', rel));
const col = (t, name) => t.cols.indexOf(name);

// ---------- A. 产物完整性 ----------
{
  const merges = JSON.parse(fs.readFileSync(path.join(tmp, 'approved', 'merges.json'), 'utf8')).merges;
  const transforms = JSON.parse(fs.readFileSync(path.join(tmp, 'approved', 'transforms.json'), 'utf8')).transforms;
  const expect = transforms.map((t) => `${t.id}.csv`).concat(merges.map((m) => `${m.id}.csv`), merges.map((m) => `${m.id}-mapping.csv`)).sort();
  report.completeness = {
    files: outFiles.length,
    expected: expect.length,
    missing: expect.filter((f) => !outFiles.includes(f)),
    unexpected: outFiles.filter((f) => !expect.includes(f)),
    transformCount: transforms.length,
    mergeCount: merges.length,
  };
}

// ---------- B. 数据质量 ----------
{
  // B1 日期链：date_dmy_to_iso 产物应全 ISO 无脏格式
  const dates = csv('date_dmy_to_iso.csv');
  const di = col(dates, 'date');
  const nonIso = dates.rows.filter((row) => !/^\d{4}-\d{2}-\d{2}$/.test(row[di])).length;
  // B2 金额：money_cast_number 的 base_salary 空值 0 且 > 0
  const money = csv('money_cast_number.csv');
  const mi = col(money, 'base_salary');
  const moneyEmpty = money.rows.filter((row) => row[mi] === '').length;
  const moneyNonPositive = money.rows.filter((row) => row[mi] !== '' && Number(row[mi]) <= 0).length;
  // B3 行数守恒（转换产物 vs 源表；filter 规则除外）
  const transforms = JSON.parse(fs.readFileSync(path.join(tmp, 'approved', 'transforms.json'), 'utf8')).transforms;
  const rowCheck = [];
  for (const t of transforms) {
    if (t.type === 'filter') continue;
    const srcRel = Object.values(JSON.parse(fs.readFileSync(path.join(tmp, 'sources', `${t.source}.json`), 'utf8')))[0] || null;
    let srcPath;
    try {
      const src = JSON.parse(fs.readFileSync(path.join(tmp, 'sources', `${t.source}.json`), 'utf8'));
      srcPath = src.path || null;
    } catch { srcPath = null; }
    if (!srcPath) { rowCheck.push({ id: t.id, skip: '源路径未知' }); continue; }
    const srcAbs = path.isAbsolute(srcPath) ? srcPath : path.join(tmp, srcPath);
    if (!fs.existsSync(srcAbs)) { rowCheck.push({ id: t.id, skip: '源文件缺失' }); continue; }
    const srcRows = readCsvFile(srcAbs).rows.length;
    const outRows = csv(`${t.id}.csv`).rows.length;
    rowCheck.push({ id: t.id, srcRows, outRows, lost: srcRows - outRows });
  }
  // B4 清洗抽查：company_trim 产物 name 无首尾空白
  const trimmed = csv('company_trim.csv');
  const ti = col(trimmed, 'company_name');
  const trimLeftover = trimmed.rows.filter((row) => (row[ti] ?? '') !== String(row[ti] ?? '').trim()).length;

  report.dataQuality = {
    dates_nonIso_after_chain: nonIso,
    money_empty_after_cast: moneyEmpty,
    money_nonPositive: moneyNonPositive,
    rowCountConservation: rowCheck,
    trim_leftover: trimLeftover,
  };
}

// ---------- C. 关联一致性 ----------
{
  // C1 合并产物主键重复：merge_cust_rs_1 产物 CUST-1 出现次数
  const m1 = csv('merge_cust_rs_1.csv');
  const ki = col(m1, 'customer_id');
  const dup = {};
  for (const row of m1.rows) dup[row[ki]] = (dup[row[ki]] || 0) + 1;
  const dups = Object.entries(dup).filter(([, n]) => n > 1);
  const custCounts = Object.values(dup).reduce((a, n) => (n > 1 ? a + 1 : a), 0);
  // 全部客户合并产物主键重复统计
  const mergeDup = [];
  for (const f of outFiles) {
    if (!/^merge_cust_/.test(f)) continue;
    const t = csv(f);
    const k = col(t, 'customer_id');
    if (k < 0) continue;
    const seen = new Set();
    let dupCount = 0;
    for (const row of t.rows) {
      if (seen.has(row[k])) dupCount++;
      seen.add(row[k]);
    }
    mergeDup.push({ file: f, rows: t.rows.length, dupRows: dupCount });
  }
  // C2 同一 right 值多引用：SC-1 被 rs_1 与 ms_1 引用 → 检查两个合并产物是否都含 SC-1 改键后的行（按 email 匹配）
  const rs1 = csv('merge_cust_rs_1.csv');
  const ms1 = csv('merge_cust_ms_1.csv');
  const saasCust = raw('saas/customers_saas.csv');
  const scEmailIdx = col(saasCust, 'email');
  const sc1Email = saasCust.rows.find((r) => r[0] === 'SC-1')?.[scEmailIdx];
  const rsEmailIdx = col(rs1, 'email');
  const msEmailIdx = col(ms1, 'email');
  const inRs = rs1.rows.some((row) => row[rsEmailIdx] === sc1Email);
  const inMs = ms1.rows.some((row) => row[msEmailIdx] === sc1Email);
  // C3 外键失配：subscriptions.customer_id（SC-*）在"合并后客户全集"中命中率
  const subs = raw('saas/subscriptions.csv');
  const si = col(subs, 'customer_id');
  const custAll = new Set();
  for (const f of outFiles) {
    if (!/^merge_cust_/.test(f)) continue;
    const t = csv(f);
    const k = col(t, 'customer_id');
    for (const row of t.rows) custAll.add(row[k]);
  }
  const subCust = subs.rows.map((row) => row[si]);
  const subUnique = new Set(subCust);
  let subHit = 0;
  for (const c of subUnique) if (custAll.has(c)) subHit++;
  // mfg 侧外键：shipments_mfg.customer_id（MC-*）命中率（customers_mfg 被 rm 合并改键后 MC-111..114 已变 CUST-111..114）
  const po = raw('mfg/shipments_mfg.csv');
  const pi = col(po, 'customer_id');
  const poUnique = new Set(po.rows.map((row) => row[pi]));
  let poHit = 0;
  for (const c of poUnique) if (custAll.has(c)) poHit++;
  // C4 mapping 与声明一致（readCsvFile 行是数组：[right, left]）
  const merges = JSON.parse(fs.readFileSync(path.join(tmp, 'approved', 'merges.json'), 'utf8')).merges;
  const mappingOk = [];
  for (const m of merges) {
    const mp = csv(`${m.id}-mapping.csv`);
    const ok = mp.rows.length === 1 && mp.rows[0][0] === m.right.value && mp.rows[0][1] === m.left.value;
    mappingOk.push({ id: m.id, ok });
  }

  report.relational = {
    merge_cust_rs1_dupRows: dups.length,
    merge_cust_rs1_dupKeys: dups.slice(0, 5),
    allCustomerMergeDup: mergeDup,
    subscriptions_fk_hit: { uniqueRefs: subUnique.size, hit: subHit, miss: subUnique.size - subHit },
    mfgOrders_fk_hit: { uniqueRefs: poUnique.size, hit: poHit, miss: poUnique.size - poHit },
    mappingConsistency: { total: mappingOk.length, bad: mappingOk.filter((x) => !x.ok).map((x) => x.id) },
    sc1_splitAcrossEntities: { email: sc1Email, inRetailMerge: inRs, inMfgMerge: inMs, split: inRs && inMs },
  };
}

// ---------- D. 病症可见性（企业优化信号保留） ----------
{
  // D1 库存积压：inventory_retail stock 高值行（>400，设计库存 0-500）
  const inv = raw('retail/inventory_retail.csv');
  const sIdx = col(inv, 'stock');
  const highStock = inv.rows.filter((row) => Number(row[sIdx]) > 400).length;
  // D2 churn 前兆：usage_metrics 中 will_churn 订阅按周排序后后半程骤降的订阅数
  const usage = raw('saas/usage_metrics.csv');
  const uSub = col(usage, 'subscription_id');
  const uWeek = col(usage, 'week');
  const uVal = col(usage, 'value');
  const subs = raw('saas/subscriptions.csv');
  const wcIdx = col(subs, 'will_churn');
  const willChurn = new Set(subs.rows.filter((s) => s[wcIdx] === '1').map((s) => s[0]));
  let churnSignals = 0;
  const bySub = new Map();
  for (const row of usage.rows) {
    if (!bySub.has(row[uSub])) bySub.set(row[uSub], []);
    bySub.get(row[uSub]).push({ week: Number(row[uWeek]), value: Number(row[uVal]) });
  }
  for (const [sid, pts] of bySub) {
    if (!willChurn.has(sid) || pts.length < 4) continue;
    pts.sort((a, b) => a.week - b.week);
    const half = Math.floor(pts.length / 2);
    const first = pts.slice(0, half).reduce((a, p) => a + p.value, 0) / half;
    const last = pts.slice(half).reduce((a, p) => a + p.value, 0) / (pts.length - half);
    if (first > 0 && last < first * 0.5) churnSignals++;
  }
  // D3 供应链：suppliers_retail lead_time_days > 30
  const sup = raw('retail/suppliers_retail.csv');
  const li = col(sup, 'lead_time_days');
  const longLead = sup.rows.filter((row) => Number(row[li]) > 30).length;
  // D4 员工流失：employee_exits 行数
  const exits = raw('group/employee_exits.csv');
  // D5 负数量信号：order_items 原始负 quantity 行数 vs qty_abs 产物（信号抹除）
  const oi = raw('retail/order_items.csv');
  const qi = col(oi, 'quantity');
  const negRaw = oi.rows.filter((row) => Number(row[qi]) < 0).length;
  const qtyAbs = csv('qty_abs.csv');
  const qaIdx = col(qtyAbs, 'quantity');
  const negAfter = qtyAbs.rows.filter((row) => Number(row[qaIdx]) < 0).length;
  // D6 缺陷：defects 行数
  const defs = raw('mfg/defects.csv');
  // D7 重复客户信号：mapping 覆盖 vs 设计重复对
  const merges = JSON.parse(fs.readFileSync(path.join(tmp, 'approved', 'merges.json'), 'utf8')).merges;
  const customerMerges = merges.filter((m) => m.id.startsWith('merge_cust')).length;

  report.symptomVisibility = {
    inventory_highStockRows: highStock,
    churn_droppedSubscriptions: churnSignals,
    supply_longLeadSuppliers: longLead,
    employee_exitRows: exits.rows.length,
    negativeQty: { raw: negRaw, after_qty_abs: negAfter, signalErased: negRaw > 0 && negAfter === 0 },
    defects_rows: defs.rows.length,
    duplicateCustomerPairs: { designed: 194, declared: customerMerges, coverage: +(customerMerges / 194).toFixed(2) },
  };
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
