// AI-FDE 实验评估脚本：检查交付包 D1-D8，对照 ground truth
// 用法: node eval.js <项目目录> [--strict]
'use strict';
const fs = require('fs');
const path = require('path');

function loadCsv(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return null;
  // 简易解析（含引号转义）
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

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}: ${detail}`);
}

function main() {
  const projDir = process.argv[2];
  if (!projDir) { console.error('用法: node eval.js <项目目录>'); process.exit(1); }
  const gtPath = path.join(projDir, '..', 'ground-truth.json');
  const gt = fs.existsSync(gtPath) ? JSON.parse(fs.readFileSync(gtPath, 'utf8')) : null;
  if (gt) console.log(`[ground truth] seed=${gt.seed} crm=${gt.totalCrm} saas=${gt.totalSaas} mfg=${gt.totalMfg} 重复对=${gt.crmDupWithSaas.length}+${gt.crmDupWithMfg.length} 负数量=${gt.expectedNegQty} 延迟=${gt.expectedLeadOver30}\n`);

  // ---- D1: 数据源注册 + schema 推断 ----
  const sourcesDir = path.join(projDir, 'sources');
  const schemasDir = path.join(projDir, 'schemas');
  const sourceFiles = fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir).filter(f => f.endsWith('.json')) : [];
  const schemaFiles = fs.existsSync(schemasDir) ? fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json')) : [];
  check('D1 数据源注册', sourceFiles.length >= 5, `${sourceFiles.length} 个 source 注册（期望 ≥5）`);
  check('D1 schema 推断', schemaFiles.length >= 5, `${schemaFiles.length} 个 schema（期望 ≥5）`);

  // ---- D2: 对象建模 ----
  const staging = path.join(projDir, 'staging');
  const approved = path.join(projDir, 'approved');
  function findIn(dir, pat) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) out.push(...findIn(full, pat));
      else if (pat.test(f)) out.push(full);
    }
    return out;
  }
  const objectFiles = [...findIn(approved, /objects.*\.json$/), ...findIn(staging, /objects.*\.json$/)];
  check('D2 对象建模', objectFiles.length >= 1, `objects 产物 ${objectFiles.length} 个`);
  if (objectFiles.length) {
    try {
      const objs = JSON.parse(fs.readFileSync(objectFiles[0], 'utf8'));
      const arr = Array.isArray(objs) ? objs : (objs.objects || []);
      check('D2 对象属性', arr.length >= 2 && arr.every(o => o.properties && o.properties.length > 0), `${arr.length} 个对象类型`);
    } catch (e) { check('D2 对象属性', false, `解析失败: ${e.message}`); }
  }

  // ---- D3: 清洗规则 ----
  const transformFiles = [...findIn(approved, /transforms.*\.json$/), ...findIn(staging, /transforms.*\.json$/)];
  check('D3 清洗规则', transformFiles.length >= 1, `transforms 产物 ${transformFiles.length} 个`);
  if (transformFiles.length) {
    try {
      const tr = JSON.parse(fs.readFileSync(transformFiles[0], 'utf8'));
      const arr = Array.isArray(tr) ? tr : (tr.transforms || []);
      check('D3 规则数量', arr.length >= 5, `${arr.length} 条规则`);
    } catch (e) { check('D3 规则数量', false, `解析失败: ${e.message}`); }
  }

  // ---- D4: ER 声明 + 覆盖率（对照 ground truth）----
  const mergeFiles = [...findIn(approved, /merges.*\.json$/), ...findIn(staging, /merges.*\.json$/)];
  let erCoverage = null;
  if (mergeFiles.length) {
    try {
      const mg = JSON.parse(fs.readFileSync(mergeFiles[0], 'utf8'));
      const arr = Array.isArray(mg) ? mg : (mg.merges || []);
      const declared = arr.filter(m => m.right && m.right.value);
      // 从声明提取 canonical 引用数：声明以 crm 为主表、saas/mfg 为右表时，右表 value 集合即消解对
      const declaredKeys = new Set(declared.map(d => d.right.value).filter(v => typeof v === 'string'));
      if (gt) {
        // 用 saas 邮箱映射核验：声明中若含 saas 键，统计命中
        const saasDupExpected = gt.saasDupCount + gt.mfgDupCount;
        erCoverage = { declared: declaredKeys.size, expected: saasDupExpected, hit: 0 };
        // 无法直接核对 canonical → 用右表 value 数近似（SAAS-x/MFG-x 前缀）
        for (const k of declaredKeys) {
          if (/^(SAAS|MFG)-\d+$/.test(k)) erCoverage.hit++;
        }
        check('D4 ER 声明', erCoverage.declared >= erCoverage.expected * 0.9, `声明 ${erCoverage.declared} 个右表键（期望 ≥${erCoverage.expected}，含 SAAS/MFG 前缀 ${erCoverage.hit}）`);
      } else {
        check('D4 ER 声明', declaredKeys.size > 0, `声明 ${declaredKeys.size} 个右表键（无 ground truth，仅提示）`);
      }
    } catch (e) { check('D4 ER 声明', false, `解析失败: ${e.message}`); }
  } else {
    check('D4 ER 声明', false, '无 merges 产物');
  }

  // ---- D5: 期望定义 ----
  const expFiles = [...findIn(approved, /expectations.*\.json$/), ...findIn(staging, /expectations.*\.json$/), ...findIn(projDir, /expectations.*\.json$/)];
  check('D5 期望定义', expFiles.length >= 1, `expectations 产物 ${expFiles.length} 个`);

  // ---- D6: 执行产物 + 审计 ----
  const outDir = path.join(projDir, 'output');
  const outFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  check('D6 执行产物', outFiles.length >= 5, `output/ ${outFiles.length} 个文件`);
  const auditPath = path.join(projDir, 'audit', 'audit.jsonl');
  let auditLines = 0;
  if (fs.existsSync(auditPath)) auditLines = fs.readFileSync(auditPath, 'utf8').split(/\r?\n/).filter(Boolean).length;
  check('D6 审计事件', auditLines >= 5, `audit.jsonl ${auditLines} 条事件`);

  // ---- D7: 可用性自评报告 ----
  const reportFiles = [...findIn(projDir, /report.*\.md$/), ...findIn(projDir, /自评.*\.md$/)].filter(f => !f.includes('node_modules'));
  check('D7 自评报告', reportFiles.length >= 1, `报告 ${reportFiles.length} 个`);

  // ---- 关联保留：引用命中率（D6 产物 vs 原始数据）----
  if (gt && outFiles.length) {
    // 核验：产物中 account_id 引用行仍可 join 到 saas 账户（用原始 saas 键集）
    const saasKeys = new Set();
    const saasCsv = loadCsv(path.join(projDir, '..', 'data', 'saas_accounts.csv')) || loadCsv(path.join(projDir, 'data', 'saas_accounts.csv'));
    if (saasCsv) for (const r of saasCsv.slice(1)) saasKeys.add(r[0]);
    let subRefHit = 0, subRefTotal = 0;
    for (const f of outFiles) {
      const csv = loadCsv(path.join(outDir, f));
      if (!csv) continue;
      const head = csv[0];
      const acctIdx = head.indexOf('account_id');
      if (acctIdx >= 0) {
        for (const r of csv.slice(1)) {
          subRefTotal++;
          if (saasKeys.has(r[acctIdx])) subRefHit++;
        }
      }
    }
    if (subRefTotal > 0) {
      const rate = subRefHit / subRefTotal;
      check('关联保留 account_id 命中', rate >= 0.95, `${subRefHit}/${subRefTotal} = ${(rate * 100).toFixed(1)}%（阈值 95%）`);
    } else {
      check('关联保留 account_id 命中', false, 'output 中未找到含 account_id 的产物');
    }
  }

  // ---- 信号保留：负数量 ----
  if (gt) {
    let negFound = 0;
    for (const f of outFiles) {
      const csv = loadCsv(path.join(outDir, f));
      if (!csv) continue;
      const head = csv[0];
      const qIdx = head.indexOf('quantity');
      if (qIdx >= 0) for (const r of csv.slice(1)) if (Number(r[qIdx]) < 0) negFound++;
    }
    check('信号保留 负数量', negFound >= gt.expectedNegQty * 0.9, `产物中负数量 ${negFound} 行（ground truth ${gt.expectedNegQty} 行，阈值 ≥90% 保留）`);
  }

  // ---- 汇总 ----
  const pass = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\n==== AI-FDE 交付评估: ${pass}/${total} 通过 ====`);
  process.exit(pass === total ? 0 : 1);
}
main();
