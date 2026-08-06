#!/usr/bin/env node
// validate.js — 产物格式校验器（spec §3.2）
// 校验 approved/（或 --stage 时含 staging/）的 objects/links/transforms/merges 符合规范。
// 模块接口: validateProject(projectDir, {stage}) → {ok, problems: string[]}
// CLI: node validate.js <项目目录> [--stage]
// 铁律配合: exec.js 启动时内部强制先跑本校验，失败中止、零副作用。
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const path = require('path');

const TYPES = ['regex_replace', 'regex_extract', 'map', 'filter', 'concat', 'split', 'cast', 'lower', 'upper', 'trim'];
const CARDINALITIES = ['1:1', '1:N', 'N:M'];
const FILTER_OPS = ['eq', 'neq', 'gt', 'lt', 'contains'];
const CAST_TYPES = ['string', 'integer', 'number', 'boolean', 'date'];

// §3.6 权威参数表：validate"参数齐全"的定义
const TYPE_RULES = {
  regex_replace: ['pattern', 'replacement', 'column'],
  regex_extract: ['pattern', 'column'],
  map: ['mappings', 'column'],
  filter: ['condition'],
  concat: ['columns', 'targetColumn', 'separator'],
  split: ['column', 'separator', 'targetColumns'],
  cast: ['column', 'targetType'],
  lower: ['column'],
  upper: ['column'],
  trim: ['column'],
};

const FAIL = 1;

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 读取 sources/ 注册表：id → {id, path, format}
function loadSources(projectDir) {
  const dir = path.join(projectDir, 'sources');
  if (!fs.existsSync(dir)) return new Map();
  const map = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const src = readJson(path.join(dir, f));
    if (src && src.id) map.set(src.id, src);
  }
  return map;
}

// 读取 schemas/ 列映射：源 id → 列名数组（schema 是推断时点快照，缺失则返回 null 表示"跳过检查"）
function loadSchemaColumns(projectDir, sourceId) {
  const f = path.join(projectDir, 'schemas', `${sourceId}.schema.json`);
  if (!fs.existsSync(f)) return null;
  const schema = readJson(f);
  if (!schema || !Array.isArray(schema.columns)) return null;
  return schema.columns.map((c) => c.name);
}

function validateObjects(problems, objs, scope) {
  for (const o of objs || []) {
    if (!o.id) problems.push(`✘ [${scope}/objects] 对象缺 id`);
    if (!o.displayName) problems.push(`✘ [${scope}/objects] 对象 ${o.id || '?'} 缺 displayName`);
    if (!Array.isArray(o.properties) || o.properties.length === 0) {
      problems.push(`✘ [${scope}/objects] 对象 ${o.id || '?'} 缺 properties`);
    } else if (!o.properties.some((p) => p.primaryKey === true)) {
      problems.push(`✘ [${scope}/objects] 对象 ${o.id || '?'} 缺主键属性（properties 中需有 primaryKey: true）`);
    }
  }
}

function validateLinks(problems, links, objectIds, scope) {
  for (const l of links || []) {
    if (!objectIds.has(l.source)) problems.push(`✘ [${scope}/links] 链接 ${l.id || '?'} 的 source 对象不存在: ${l.source}`);
    if (!objectIds.has(l.target)) problems.push(`✘ [${scope}/links] 链接 ${l.id || '?'} 的 target 对象不存在: ${l.target}`);
    if (!CARDINALITIES.includes(l.cardinality)) {
      problems.push(`✘ [${scope}/links] 链接 ${l.id || '?'} 的 cardinality 非法: ${l.cardinality}（可用: ${CARDINALITIES.join('/')}）`);
    }
  }
}

function transformColumns(t) {
  const cols = [];
  if (t.rule) {
    if (t.rule.column) cols.push(t.rule.column);
    if (t.rule.condition && t.rule.condition.column) cols.push(t.rule.condition.column);
    if (Array.isArray(t.rule.columns)) cols.push(...t.rule.columns);
  }
  return cols;
}

function validateTransforms(problems, transforms, sources, projectDir, scope) {
  for (const t of transforms || []) {
    const tag = `${scope}/transforms`;
    if (!TYPES.includes(t.type)) {
      problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 的 type 非法: ${t.type}（可用: ${TYPES.join('/')}）`);
      // type 非法不阻断其他检查（问题全列出原则）
    } else {
      // 参数齐全（§3.6 参数表）
      for (const arg of TYPE_RULES[t.type]) {
        if (t.rule === undefined || t.rule === null || t.rule[arg] === undefined) {
          problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 缺参数: ${arg}（type=${t.type}）`);
        }
      }
      if (t.type === 'filter' && t.rule && t.rule.condition) {
        const c = t.rule.condition;
        if (!FILTER_OPS.includes(c.op)) {
          problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 的 filter op 非法: ${c.op}（可用: ${FILTER_OPS.join('/')}）`);
        }
        if (c.value === undefined) problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 的 filter condition 缺 value`);
      }
      if (t.type === 'cast' && t.rule && t.rule.targetType && !CAST_TYPES.includes(t.rule.targetType)) {
        problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 的 cast targetType 非法: ${t.rule.targetType}（可用: ${CAST_TYPES.join('/')}）`);
      }
    }
    // source 已注册
    if (!sources.has(t.source)) {
      problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 引用的 source 未注册: ${t.source}`);
    }
    // column 存在（对照 schema；schema 缺失则跳过——推断时点快照取舍）
    const cols = sources.has(t.source) ? loadSchemaColumns(projectDir, t.source) : null;
    if (cols) {
      for (const c of transformColumns(t)) {
        if (!cols.includes(c)) {
          problems.push(`✘ [${tag}] 转换 ${t.id || '?'} 引用的 column 不存在: ${c}（source=${t.source} 的 schema 无此列）`);
        }
      }
    }
  }
}

function validateMerges(problems, merges, sources, projectDir, scope) {
  for (const m of merges || []) {
    const tag = `${scope}/merges`;
    if (typeof m.confidence !== 'number' || m.confidence < 0 || m.confidence > 1) {
      problems.push(`✘ [${tag}] 合并 ${m.id || '?'} 的 confidence 非法: ${m.confidence}（须 0-1）`);
    }
    for (const side of ['left', 'right']) {
      const s = m[side];
      if (!s || !s.source || !s.key) {
        problems.push(`✘ [${tag}] 合并 ${m.id || '?'} 缺 ${side}.source/key`);
        continue;
      }
      if (!sources.has(s.source)) {
        problems.push(`✘ [${tag}] 合并 ${m.id || '?'} 的 ${side}.source 未注册: ${s.source}`);
        continue;
      }
      const cols = loadSchemaColumns(projectDir, s.source);
      if (cols && !cols.includes(s.key)) {
        problems.push(`✘ [${tag}] 合并 ${m.id || '?'} 的 ${side}.key 不存在: ${s.key}（source=${s.source} 的 schema 无此列）`);
      }
    }
  }
}

// 核心校验：聚合全部问题，不中断。返回 {ok, problems}
function validateProject(projectDir, opts = {}) {
  const problems = [];
  const scope = opts.stage ? 'staging' : 'approved';
  const approvedDir = path.join(projectDir, 'approved');
  if (!fs.existsSync(approvedDir)) {
    return { ok: false, problems: ['✘ [exec] approved/ 目录不存在'] };
  }

  const sources = loadSources(projectDir);

  // 对象集合：approved 用 approved；--stage 用 staging + approved 作基准
  const baseObjects = readJson(path.join(approvedDir, 'objects.json')) || { objects: [] };
  const objectIds = new Set(baseObjects.objects.map((o) => o.id));
  if (opts.stage) {
    const staging = readJson(path.join(projectDir, 'staging', 'objects.json'));
    if (staging && Array.isArray(staging.objects)) {
      validateObjects(problems, staging.objects, 'staging');
      for (const o of staging.objects) objectIds.add(o.id);
    }
  }
  validateObjects(problems, baseObjects.objects, 'approved');

  const links = readJson(path.join(approvedDir, 'links.json'));
  if (links) validateLinks(problems, links.links, objectIds, 'approved');
  if (opts.stage) {
    const stagingLinks = readJson(path.join(projectDir, 'staging', 'links.json'));
    if (stagingLinks) validateLinks(problems, stagingLinks.links, objectIds, 'staging');
  }

  const transforms = readJson(path.join(approvedDir, 'transforms.json'));
  if (transforms) validateTransforms(problems, transforms.transforms, sources, projectDir, 'approved');
  if (opts.stage) {
    const stagingTransforms = readJson(path.join(projectDir, 'staging', 'transforms.json'));
    if (stagingTransforms) validateTransforms(problems, stagingTransforms.transforms, sources, projectDir, 'staging');
  }

  const merges = readJson(path.join(approvedDir, 'merges.json'));
  if (merges) validateMerges(problems, merges.merges, sources, projectDir, 'approved');
  if (opts.stage) {
    const stagingMerges = readJson(path.join(projectDir, 'staging', 'merges.json'));
    if (stagingMerges) validateMerges(problems, stagingMerges.merges, sources, projectDir, 'staging');
  }

  return { ok: problems.length === 0, problems };
}

// CLI 入口
function main() {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  const stage = args.includes('--stage');
  if (!projectDir) {
    console.error('用法: validate.js <项目目录> [--stage]');
    process.exit(FAIL);
  }
  if (!fs.existsSync(projectDir)) {
    console.error(`✘ 项目目录不存在: ${projectDir}`);
    process.exit(FAIL);
  }
  const { ok, problems } = validateProject(projectDir, { stage });
  if (ok) {
    console.log(`✔ ${stage ? 'staging' : 'approved'} 产物校验通过`);
  } else {
    console.error(`✘ 校验发现 ${problems.length} 个问题:`);
    problems.forEach((p) => console.error('  ' + p));
    process.exit(FAIL);
  }
}

if (require.main === module) main();

module.exports = { validateProject };
