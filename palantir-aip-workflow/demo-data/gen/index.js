#!/usr/bin/env node
// index.js — Meridian 控股集团演示数据集生成器（spec §5）
// 用法: node gen/index.js <项目目录> [--rows <scale>]   （scale 默认 1.0，0.1 缩 10 倍）
// 确定性：固定种子 mulberry32(20260806)，同一参数两次生成逐字节一致。
// 零依赖；CSV 复用 ../../bin/csv.js；schemas 由 Task 5 集成 schema-infer 生成。
'use strict';

const fs = require('fs');
const path = require('path');

const { TABLES, buildDuplicateCustomers, SUPPLIER_NAMES, mulberry32 } = require('./tables.js');
const { stringify } = require('../../bin/csv.js');

const SEED = 20260806;

// ---------- 生成上下文 ctx ----------
function makeCtx(scale) {
  const rng = mulberry32(SEED);
  const tables = new Map(); // id → {cols, rows}

  const ctx = {
    rng,
    tables,
    scale,
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    randInt: (min, max) => min + Math.floor(rng() * (max - min + 1)),
    // 外键采样：从已生成表随机取一行的 key 值
    fk: (ref, key) => {
      const t = tables.get(ref);
      if (!t) throw new Error(`FK 引用未生成的表: ${ref}（生成顺序错误）`);
      return t.rows[Math.floor(rng() * t.rows.length)][key];
    },
    // 按条件采样（如离职员工）
    fkWhere: (ref, key, pred) => {
      const t = tables.get(ref);
      const pool = t.rows.filter(pred);
      return pool[Math.floor(rng() * pool.length)][key];
    },
    // 日期：2024-01-01 ~ endYear-12-31 之间的随机日期
    randDate: (startYear, endYear) => {
      const y = ctx.randInt(startYear, endYear);
      const m = ctx.randInt(1, 12);
      const d = ctx.randInt(1, 28);
      return new Date(y, m - 1, d);
    },
    // 三格式日期（spec §4.2）：YYYY-MM-DD 50% / MM/DD/YYYY 30% / DD-MM-YYYY 20%
    dateFmt: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const r = rng();
      if (r < 0.5) return `${y}-${m}-${day}`;
      if (r < 0.8) return `${m}/${day}/${y}`;
      return `${day}-${m}-${y}`;
    },
    // 三格式金额（spec §4.2）：1234.5 50% / $1,234.50 30% / 1 234,50 20%
    moneyFmt: (n) => {
      const r = rng();
      if (r < 0.5) return String(n);
      if (r < 0.8) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${rng() < 0.5 ? ',00' : ''}`;
    },
    // 月份：2024-01 ~ 2026-06（YYYY-MM 或 MM/YYYY 混）
    monthFmt: () => {
      const y = ctx.randInt(2024, 2026);
      const m = String(ctx.randInt(1, 12)).padStart(2, '0');
      return rng() < 0.8 ? `${y}-${m}` : `${m}/${y}`;
    },
    // 姓名/邮箱脏化：大小写/空白（spec §4.2）
    dirtyStr: (s) => {
      const r = rng();
      if (r < 0.2) return `  ${s}  `;
      if (r < 0.4) return s.toUpperCase();
      if (r < 0.5) return s.toLowerCase();
      return s;
    },
  };
  return ctx;
}

// ---------- 生成主流程 ----------
function generate(projectDir, scale = 1.0) {
  const abs = path.resolve(projectDir);
  fs.mkdirSync(path.join(abs, 'data'), { recursive: true });
  fs.mkdirSync(path.join(abs, 'sources'), { recursive: true });

  const ctx = makeCtx(scale);
  const generated = [];

  // 跨源重复种子（spec §4.1）：先于表生成，供各板块 customers/suppliers 引用
  ctx.duplicates = {
    customers: buildDuplicateCustomers(ctx.rng),
  };

  for (const t of TABLES) {
    const n = Math.max(1, Math.ceil(t.rows * scale));
    const rows = [];
    const dataDir = path.join(abs, 'data', t.dir);
    fs.mkdirSync(dataDir, { recursive: true });
    // 种子行（跨源变体）优先：前 seed().length 行直接用种子对象
    const seeds = t.seed ? t.seed(ctx) : [];
    for (let r = 0; r < n; r++) {
      const row = {};
      if (r < seeds.length) {
        Object.assign(row, seeds[r]);
      } else {
        for (const c of t.cols) row[c.name] = String(c.gen(r, ctx));
      }
      if (t.fks) {
        for (const f of t.fks) row[f.col] = ctx.fk(f.ref, f.key);
      }
      rows.push(row);
    }
    if (t.after) t.after(rows, ctx);
    ctx.tables.set(t.id, { cols: t.cols.map((c) => c.name), rows });

    const csvPath = path.join(dataDir, `${t.id}.csv`);
    fs.writeFileSync(csvPath, stringify(t.cols.map((c) => c.name), rows.map((r) => t.cols.map((c) => r[c.name]))));

    // sources 注册（联邦引用，spec §2）
    const src = {
      id: `${t.id}.csv`,
      path: path.join(dataDir, `${t.id}.csv`),
      format: 'csv',
      description: `${t.dir} 板块 - ${t.id}`,
      copied: true,
    };
    fs.writeFileSync(path.join(abs, 'sources', `${t.id}.csv.json`), JSON.stringify(src, null, 2) + '\n');

    generated.push({ id: t.id, rows: n, bytes: fs.statSync(csvPath).size });
  }

  // config.json / state.json（paip 项目骨架）
  const stateSteps = { init: 'done', source: 'done', infer: 'done', model: 'done', entity: 'done', review: 'in_progress', exec: 'pending' };
  fs.writeFileSync(path.join(abs, 'config.json'), JSON.stringify({
    project: { name: 'company-group', description: 'Meridian 控股集团演示数据集', created: '2026-08-06', version: '1.0.0' },
    state: { currentStep: 'review', steps: stateSteps },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(abs, 'state.json'), JSON.stringify({
    currentStep: 'review', steps: stateSteps, sources: [], lastEventId: 0, stats: {},
  }, null, 2) + '\n');

  return { tables: generated, bytes: generated.reduce((s, g) => s + g.bytes, 0) };
}

// ---------- CLI ----------
function main() {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  let scale = 1.0;
  const idx = args.indexOf('--rows');
  if (idx >= 0 && args[idx + 1]) scale = parseFloat(args[idx + 1]);
  if (!projectDir) {
    console.error('用法: node gen/index.js <项目目录> [--rows <scale>]');
    process.exit(1);
  }
  const r = generate(projectDir, scale);
  console.log(`✔ 生成 ${r.tables.length} 张表，${(r.bytes / 1024 / 1024).toFixed(2)} MB（scale=${scale}）`);
  console.log(`  项目目录: ${path.resolve(projectDir)}`);
}

if (require.main === module) main();

module.exports = { generate, SEED };
