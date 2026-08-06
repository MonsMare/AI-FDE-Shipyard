#!/usr/bin/env node
// exec.js — 确定性执行引擎（spec §3.1/§4/§5）
// 读 approved/transforms.json + approved/merges.json → 内部强制先跑 validate →
// 纯 JS 行级执行（9 种规则，§3.6 执行细则）→ merge（键映射替换，§4）→ 统一写盘 output/<id>.csv → 审计。
// 铁律：失败中止，数据不动，状态不推进。
// 接口: execProject(projectDir, {transformIds, mergeIds}) → {ok, outputs, events, problems?}
// CLI: node exec.js <项目目录> [--transform <id>] [--merge <id>]
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const path = require('path');

const { readCsvFile, writeCsvFile, parseCsv } = require('./csv.js');
const { validateProject } = require('./validate.js');
const { addEvent, stepTo } = require('./audit.js');

const FAIL = 1;
const FILTER_OPS = ['eq', 'neq', 'gt', 'lt', 'contains'];
const CAST_TYPES = ['string', 'integer', 'number', 'boolean', 'date'];

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// ==================== cast / 比较（§3.6 执行细则，实验确认） ====================

function castValue(v, targetType) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  switch (targetType) {
    case 'string': return s;
    case 'integer': return /^-?\d+$/.test(s) ? String(parseInt(s, 10)) : null;
    case 'number': return /^-?\d*\.?\d+$/.test(s) ? String(parseFloat(s)) : null;
    case 'boolean': {
      if (/^(true|TRUE|1)$/.test(s)) return 'true';
      if (/^(false|FALSE|0)$/.test(s)) return 'false';
      return null;
    }
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
    default: throw new Error(`未知 targetType: ${targetType}`);
  }
}

// 数值可解析时按数值比较（实验确认：字符串序会让 '9' > '18'）
function cmp(a, b) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && /^-?\d/.test(a) && /^-?\d/.test(b)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ==================== 规则执行（9 种，§3.6） ====================

// 对一行应用规则（filter 返回布尔，其余就地修改行）。返回 null 表示行被丢弃。
function applyRule(row, rule) {
  const col = (c) => row[c];
  const set = (c, v) => { row[c] = v; };
  switch (rule.type) {
    case 'regex_replace': {
      const re = new RegExp(rule.pattern, 'g');
      set(rule.column, String(col(rule.column) ?? '').replace(re, rule.replacement));
      return;
    }
    case 'regex_extract': {
      const re = new RegExp(rule.pattern);
      const m = String(col(rule.column) ?? '').match(re);
      set(rule.column, m ? (m[1] !== undefined ? m[1] : m[0]) : null);
      return;
    }
    case 'map': {
      const v = col(rule.column);
      if (v in rule.mappings) set(rule.column, rule.mappings[v]);
      return; // 未命中保持原值
    }
    case 'filter': {
      const { column, op, value } = rule.condition;
      const v = col(column);
      switch (op) {
        case 'eq': return cmp(v, value) === 0;
        case 'neq': return cmp(v, value) !== 0;
        case 'gt': return cmp(v, value) > 0;
        case 'lt': return cmp(v, value) < 0;
        case 'contains': return String(v ?? '').includes(String(value));
        default: throw new Error(`未知 op: ${op}`);
      }
    }
    case 'concat': {
      const parts = rule.columns.map((c) => String(col(c) ?? ''));
      set(rule.targetColumn, parts.join(rule.separator));
      return;
    }
    case 'split': {
      const parts = String(col(rule.column) ?? '').split(rule.separator);
      rule.targetColumns.forEach((tc, i) => set(tc, i < parts.length ? parts[i] : ''));
      return;
    }
    case 'cast': {
      set(rule.column, castValue(col(rule.column), rule.targetType));
      return;
    }
    case 'lower': set(rule.column, String(col(rule.column) ?? '').toLowerCase()); return;
    case 'upper': set(rule.column, String(col(rule.column) ?? '').toUpperCase()); return;
    case 'trim': set(rule.column, String(col(rule.column) ?? '').trim()); return;
    default: throw new Error(`未知规则 type: ${rule.type}`);
  }
}

// 对表应用一条 transform：{cols, rows} → {cols, rows}（filter 缩减行集，新列并入 cols）
function applyTransform(tbl, t) {
  let cols = tbl.cols.slice();
  let rows = tbl.rows.map((r) => Object.assign({}, r));
  const rule = Object.assign({ type: t.type }, t.rule); // type 在顶层，参数在 t.rule
  if (t.type === 'filter') {
    rows = rows.filter((r) => applyRule(r, rule));
  } else {
    for (const r of rows) applyRule(r, rule);
  }
  // 新列声明在 rule 参数内（concat.targetColumn / split.targetColumns）
  if (rule.targetColumn && !cols.includes(rule.targetColumn)) cols = cols.concat([rule.targetColumn]);
  if (t.type === 'split') {
    for (const tc of rule.targetColumns) if (!cols.includes(tc)) cols = cols.concat([tc]);
  }
  return { cols, rows };
}

// ==================== merge（§4：键映射替换，value 声明驱动） ====================

// left/right 声明 {source, key, value}：右表 key===value 的行主键替换为 left.value 并入左表。
// 返回 {ok, merged: {cols, rows}, mapping: {cols, rows}}；fan-out 时 ok=false。
function applyMerge(left, right, m) {
  const li = left.cols.indexOf(m.left.key);
  const ri = right.cols.indexOf(m.right.key);
  if (li < 0 || ri < 0) return { ok: false, reason: `合并键列不存在: ${m.left.key}/${m.right.key}` };

  // fan-out 防护：匹配值在各自表内必须唯一（行是对象行，按列名取值）
  const leftMatches = left.rows.filter((r) => r[m.left.key] === m.left.value);
  const rightMatches = right.rows.filter((r) => r[m.right.key] === m.right.value);
  if (leftMatches.length > 1) return { ok: false, reason: `合并键不唯一（fan-out）: left.${m.left.key}=${m.left.value} 出现 ${leftMatches.length} 次` };
  if (rightMatches.length > 1) return { ok: false, reason: `合并键不唯一（fan-out）: right.${m.right.key}=${m.right.value} 出现 ${rightMatches.length} 次` };

  // 列：左表列 + 右表非键列（同名列 → _right 后缀；独有列直接并入）
  const rightCols = right.cols.filter((c) => c !== m.right.key);
  const rightRenamed = {};
  const mergedCols = left.cols.slice();
  for (const rc of rightCols) {
    if (left.cols.includes(rc)) {
      rightRenamed[rc] = rc + '_right';
      if (!mergedCols.includes(rc + '_right')) mergedCols.push(rc + '_right');
    } else if (!mergedCols.includes(rc)) {
      mergedCols.push(rc);
    }
  }

  const merged = left.rows.map((lr) => Object.assign({}, lr));
  // 左优先：合并行以左表匹配行为基础（canonical），右表行只提供独有列与 _right 冲突列
  const leftMatch = leftMatches[0] || null;
  for (const rr of rightMatches) {
    const row = leftMatch ? Object.assign({}, leftMatch) : {};
    for (const rc of rightCols) {
      if (rightRenamed[rc]) row[rightRenamed[rc]] = rr[rc];
      else if (!(rc in row)) row[rc] = rr[rc]; // 独有列才直接写入
    }
    merged.push(row);
  }

  return {
    ok: true,
    merged: { cols: mergedCols, rows: merged },
    mapping: { cols: ['right', 'left'], rows: [{ right: m.right.value, left: m.left.value }] },
  };
}

// ==================== 执行引擎 ====================

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

// 加载表：CSV 用 csv.js；JSON 数组直接解析。数据文件不存在 → throw
// 统一为对象行表示（{列名: 值}），供规则按列名访问；写盘时再转数组行
function loadTable(src) {
  const p = src.path;
  if (!fs.existsSync(p)) throw new Error(`数据文件不存在: ${p}（source=${src.id}）`);
  const toObjRows = (cols, rows) => ({
    cols,
    rows: rows.map((r) => {
      const o = {};
      cols.forEach((c, i) => { o[c] = r[i] === undefined || r[i] === null ? '' : String(r[i]); });
      return o;
    }),
  });
  if (src.format === 'json') {
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(arr)) throw new Error(`JSON 数据源须为数组: ${p}`);
    const cols = Object.keys(arr[0] || {});
    return toObjRows(cols, arr.map((o) => cols.map((c) => (o[c] === undefined || o[c] === null ? '' : String(o[c])))));
  }
  const { cols, rows } = readCsvFile(p);
  return toObjRows(cols, rows);
}

// 核心：{ok, outputs, events, problems?}
function execProject(projectDir, opts = {}) {
  const approvedDir = path.join(projectDir, 'approved');
  if (!fs.existsSync(approvedDir)) {
    return { ok: false, outputs: [], events: [], problems: ['✘ [exec] approved/ 目录不存在'] };
  }

  // 内部强制先跑校验（§5 铁律：失败中止、零副作用）
  const v = validateProject(projectDir);
  if (!v.ok) {
    addEvent(projectDir, 'exec', 'exec_failed', '', `validate 拒绝: ${v.problems.join('; ')}`);
    return { ok: false, outputs: [], events: [], problems: v.problems };
  }

  const transforms = (readJson(path.join(approvedDir, 'transforms.json')) || { transforms: [] }).transforms;
  const merges = (readJson(path.join(approvedDir, 'merges.json')) || { merges: [] }).merges;
  const wantedT = opts.transformIds ? new Set(opts.transformIds) : null;
  const wantedM = opts.mergeIds ? new Set(opts.mergeIds) : null;
  const ts = wantedT ? transforms.filter((t) => wantedT.has(t.id)) : transforms;
  const ms = wantedM ? merges.filter((m) => wantedM.has(m.id)) : merges;

  if (ts.length === 0 && ms.length === 0) {
    return { ok: true, outputs: [], events: [] }; // 无事可做，成功退出
  }

  const sources = loadSources(projectDir);
  const tables = new Map(); // sourceId → {cols, rows}（内存链式：后规则看到前规则产物）
  const outputs = [];
  const events = [];

  try {
    // 1) 全部 transform（数组顺序 = 执行顺序）
    for (const t of ts) {
      let tbl = tables.get(t.source);
      if (!tbl) {
        const src = sources.get(t.source);
        if (!src) throw new Error(`转换 ${t.id} 引用的 source 未注册: ${t.source}`);
        tbl = loadTable(src);
        tables.set(t.source, tbl);
      }
      const out = applyTransform(tbl, t);
      tables.set(t.source, out);
      outputs.push({ id: t.id, table: out });
      events.push({ action: 'transform_executed', target: t.id });
    }

    // 2) 全部 merge（先 transform 后 merge：合并作用于已清洗数据）
    for (const m of ms) {
      const leftSrc = sources.get(m.left.source);
      const rightSrc = sources.get(m.right.source);
      if (!leftSrc) throw new Error(`合并 ${m.id} 的 left.source 未注册: ${m.left.source}`);
      if (!rightSrc) throw new Error(`合并 ${m.id} 的 right.source 未注册: ${m.right.source}`);
      const left = tables.get(m.left.source) || loadTable(leftSrc);
      const right = tables.get(m.right.source) || loadTable(rightSrc);
      const res = applyMerge(left, right, m);
      if (!res.ok) throw new Error(`合并 ${m.id} 中止: ${res.reason}`);
      outputs.push({ id: m.id, table: res.merged });
      outputs.push({ id: `${m.id}-mapping`, table: res.mapping });
      events.push({ action: 'merge_executed', target: m.id });
    }
  } catch (e) {
    addEvent(projectDir, 'exec', 'exec_failed', '', e.message);
    return { ok: false, outputs: [], events: [], problems: [`✘ ${e.message}`] };
  }

  // 3) 统一写盘（内存算完才写；写盘失败 → 中止并报告）
  // exec 内部用对象行（按列名访问）；csv.js stringify 需要数组行 → 写盘前转换
  const outDir = path.join(projectDir, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    for (const o of outputs) {
      const arrRows = o.table.rows.map((r) => o.table.cols.map((c) => (r[c] === undefined || r[c] === null ? '' : String(r[c]))));
      writeCsvFile(path.join(outDir, `${o.id}.csv`), o.table.cols, arrRows);
    }
  } catch (e) {
    addEvent(projectDir, 'exec', 'exec_failed', '', `写盘失败: ${e.message}`);
    return { ok: false, outputs: [], events: [], problems: [`✘ 写盘失败: ${e.message}`] };
  }

  // 4) 审计一次性记录 + 状态推进（成功才推进；失败时不推进）
  for (const ev of events) addEvent(projectDir, 'exec', ev.action, ev.target, '');
  stepTo(projectDir, 'exec'); // currentStep=review → exec；其他状态不推进（不报错）

  return { ok: true, outputs: outputs.map((o) => `${o.id}.csv`), events };
}

// CLI
function main() {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  if (!projectDir) {
    console.error('用法: exec.js <项目目录> [--transform <id>] [--merge <id>]');
    process.exit(FAIL);
  }
  if (!fs.existsSync(projectDir)) {
    console.error(`✘ 项目目录不存在: ${projectDir}`);
    process.exit(FAIL);
  }
  const transformIds = [];
  const mergeIds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transform' && args[i + 1]) transformIds.push(args[i + 1]);
    if (args[i] === '--merge' && args[i + 1]) mergeIds.push(args[i + 1]);
  }
  const r = execProject(projectDir, {
    transformIds: transformIds.length ? transformIds : undefined,
    mergeIds: mergeIds.length ? mergeIds : undefined,
  });
  if (!r.ok) {
    for (const p of r.problems) console.error('  ' + p);
    process.exit(FAIL);
  }
  if (r.outputs.length === 0) {
    console.log('✔ 无事可做（approved/ 无转换或合并规则）');
    return;
  }
  console.log(`✔ 执行完成，产物 ${r.outputs.length} 个:`);
  for (const o of r.outputs) console.log(`  output/${o}`);
  console.log(`✔ 审计事件 ${r.events.length} 条已记录`);
}

if (require.main === module) main();

module.exports = { execProject };
