#!/usr/bin/env node
// eval.js — evals-lite：单条规则效果评估（v2.1 初版）
// evalRule(projectDir, transform)：在项目临时副本上执行单条 transform，
// 输出执行前后 rowCount / emptyCount(指定列) / samples(前后各 3 行) 对照，
// 供 LLM/用户判断规则效果（规则进入 staging/approved 前的验证环节）。
// 接口: evalRule(projectDir, transform) → {ok, ruleId, source, column,
//        before: {rowCount, emptyCount, samples}, after: {...},
//        changes: {rowDelta, emptyDelta, dirtyDelta}}（validate 失败 → {ok:false, problems}）
// CLI: node eval.js <项目目录> <规则id>（规则从 approved/transforms.json 取）
// 零副作用铁律：mkdtemp 副本 → execProject(副本) → 读副本 output → 清理副本。
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execProject } = require('./exec.js');
const { readCsvFile } = require('./csv.js');

const FAIL = 1;

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 读取 sources/ 注册表：id → {id, path, format}（与 exec.js 同语义）
function loadSources(projectDir) {
  const dir = path.join(projectDir, 'sources');
  const map = new Map();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const src = readJson(path.join(dir, f));
      if (src && src.id) map.set(src.id, src);
    }
  }
  return map;
}

// 目标对照列：regex_replace/cast/lower 等用 rule.column；concat 用 targetColumn；
// filter 用 condition.column；无列可对照（如 split 的多列）返回 null → emptyCount=0、样本值为 null
function ruleColumn(rule) {
  if (!rule) return null;
  if (rule.column) return rule.column;
  if (rule.targetColumn) return rule.targetColumn;
  if (rule.condition && rule.condition.column) return rule.condition.column;
  return null;
}

// 加载表：CSV 用 csv.js；JSON 数组直接解析（与 exec.js loadTable 同语义：单元格统一字符串，空 → ''）
function loadTable(src) {
  if (src.format === 'json') {
    const arr = JSON.parse(fs.readFileSync(src.path, 'utf8'));
    if (!Array.isArray(arr)) throw new Error(`JSON 数据源须为数组: ${src.path}`);
    const cols = Object.keys(arr[0] || {});
    const rows = arr.map((o) => cols.map((c) => (o[c] === undefined || o[c] === null ? '' : String(o[c]))));
    return { cols, rows };
  }
  return readCsvFile(src.path);
}

// 计算指标：{rowCount, emptyCount(指定列), samples(最多 3 行，{row, value} 含该列前后值，行号 1 起对齐便于对照)}
function measure(tbl, column) {
  const colIdx = column ? tbl.cols.indexOf(column) : -1;
  const emptyCount = colIdx < 0 ? 0 : tbl.rows.filter((r) => r[colIdx] === '' || r[colIdx] === null || r[colIdx] === undefined).length;
  const samples = tbl.rows.slice(0, 3).map((r, i) => ({ row: i + 1, value: colIdx < 0 ? null : (r[colIdx] === undefined || r[colIdx] === null ? '' : String(r[colIdx])) }));
  return { rowCount: tbl.rows.length, emptyCount, samples };
}

// 核心评估：临时副本上执行单条规则并输出前后对照
function evalRule(projectDir, transform) {
  const problems = [];
  if (!transform || typeof transform !== 'object') return { ok: false, problems: ['✘ [eval] transform 必须是规则对象'] };
  if (!transform.id) problems.push('✘ [eval] 规则缺 id');
  if (!transform.source) problems.push('✘ [eval] 规则缺 source');
  if (!transform.type) problems.push('✘ [eval] 规则缺 type');
  if (!transform.rule || typeof transform.rule !== 'object') problems.push('✘ [eval] 规则缺 rule');
  if (problems.length > 0) return { ok: false, problems };
  if (typeof projectDir !== 'string' || !fs.existsSync(projectDir)) {
    return { ok: false, problems: [`✘ [eval] 项目目录不存在: ${projectDir}`] };
  }

  const id = transform.id;
  const column = ruleColumn(transform.rule);
  let copyDir = null;
  try {
    // 1) 临时副本（零副作用铁律：评估绝不在原项目上执行）
    copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-eval-'));
    fs.cpSync(projectDir, copyDir, { recursive: true });
    // 副本自包含：项目内源（copied !== false）的 path 重写指向副本 data（同 e2e setupDemo 的 REPLACE_ME 约定）；
    // 联邦源（copied === false，path 指向项目外）保留原 path——副本上只读外部数据文件，无副作用
    const dataDir = path.join(copyDir, 'data');
    const sourcesDir = path.join(copyDir, 'sources');
    if (fs.existsSync(sourcesDir)) {
      for (const name of fs.readdirSync(sourcesDir)) {
        if (!name.endsWith('.json')) continue;
        const p = path.join(sourcesDir, name);
        const src = readJson(p);
        if (src && src.path && src.copied !== false) {
          src.path = path.join(dataDir, path.basename(src.path.replace('REPLACE_ME/', '')));
          fs.writeFileSync(p, JSON.stringify(src, null, 2));
        }
      }
    }

    // 2) 副本 approved/transforms.json 只保留待评估规则（单条执行，指定 transformIds 时不执行 merge）
    const approvedDir = path.join(copyDir, 'approved');
    if (!fs.existsSync(approvedDir)) return { ok: false, problems: ['✘ [eval] approved/ 目录不存在（项目副本）'] };
    fs.writeFileSync(path.join(approvedDir, 'transforms.json'), JSON.stringify({ transforms: [transform] }, null, 2));

    // 3) before：读源数据表（列不存在 → emptyCount 0）
    const src = loadSources(copyDir).get(transform.source);
    if (!src) return { ok: false, problems: [`✘ [eval] source 未注册: ${transform.source}`] };
    let before;
    try {
      before = measure(loadTable(src), column);
    } catch (e) {
      return { ok: false, problems: [`✘ [eval] 读取源数据失败: ${e.message}`] };
    }

    // 4) 副本上执行单条规则（execProject 内部强制 validate；validate 拒绝 → 返回 ok:false，不抛异常）
    const r = execProject(copyDir, { transformIds: [id] });
    if (!r.ok) return { ok: false, problems: r.problems };

    // 5) after：读副本产物 output/<id>.csv
    let after;
    try {
      after = measure(readCsvFile(path.join(copyDir, 'output', `${id}.csv`)), column);
    } catch (e) {
      return { ok: false, problems: [`✘ [eval] 读取产物失败: ${e.message}`] };
    }

    return {
      ok: true,
      ruleId: id,
      source: transform.source,
      column,
      before,
      after,
      changes: {
        rowDelta: after.rowCount - before.rowCount,
        emptyDelta: after.emptyCount - before.emptyCount,
        dirtyDelta: null, // v2.2 补 dirty 模式检测（脏值命中率）；初版用空值率 + 样本人工/LLM 判断
      },
    };
  } finally {
    // 无论成败都清理副本
    if (copyDir) fs.rmSync(copyDir, { recursive: true, force: true });
  }
}

// CLI：node eval.js <项目目录> <规则id>
function main() {
  const args = process.argv.slice(2);
  const projectDir = args[0];
  const ruleId = args[1];
  if (!projectDir || !ruleId) {
    console.error('用法: eval.js <项目目录> <规则id>（规则从 approved/transforms.json 取）');
    process.exit(FAIL);
  }
  if (!fs.existsSync(projectDir)) {
    console.error(`✘ 项目目录不存在: ${projectDir}`);
    process.exit(FAIL);
  }
  // 规则定位：approved 优先；找不到回退 staging（paip-model 在规则正式进 staging 状态前先用 eval 展示对照）
  const tf = readJson(path.join(projectDir, 'approved', 'transforms.json'));
  let rule = tf && Array.isArray(tf.transforms) ? tf.transforms.find((t) => t.id === ruleId) : null;
  let scope = 'approved';
  if (!rule) {
    const st = readJson(path.join(projectDir, 'staging', 'transforms.json'));
    rule = st && Array.isArray(st.transforms) ? st.transforms.find((t) => t.id === ruleId) : null;
    if (rule) scope = 'staging';
  }
  if (!rule) {
    console.error(`✘ approved/staging 中找不到规则: ${ruleId}`);
    process.exit(FAIL);
  }
  const r = evalRule(projectDir, rule);
  if (!r.ok) {
    for (const p of r.problems) console.error('  ' + p);
    process.exit(FAIL);
  }
  r.scope = scope; // 规则来源（approved/staging），便于 skill 场景识别
  console.log(JSON.stringify(r, null, 2));
}

if (require.main === module) main();

module.exports = { evalRule };
