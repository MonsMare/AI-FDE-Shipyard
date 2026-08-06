// merge-semantics/scripts/run.js — 只产数据，不下结论
// 验证 spec §4 合并语义：键映射替换 / 左表优先 / fan-out 防护 / 同名列 _right / mapping 表
// 运行: node scripts/run.js
'use strict';

// ============ 参考实现（实验用最小 merge 核心，非正式交付） ============
// merge 声明（pair 级）: { id, left: {source, key}, right: {source, key} }
// 执行: 构建 右键→左键 映射表 → 左表行保留，右表行主键替换后并入（左优先补齐）

function runMerge(leftRows, rightRows, keyCol, mergeId) {
  // fan-out 防护: 两侧 key 必须唯一
  const countDup = (rows) => {
    const seen = new Set();
    for (const r of rows) {
      const k = String(r[keyCol]);
      if (seen.has(k)) return k;
      seen.add(k);
    }
    return null;
  };
  const lDup = countDup(leftRows);
  const rDup = countDup(rightRows);
  if (lDup !== null || rDup !== null) {
    return { ok: false, reason: `键不唯一: left=${lDup} right=${rDup}`, merged: null, mapping: null };
  }

  // 键映射表: rightKey → leftKey（右表键在左表有对应才映射）
  const leftKeys = new Set(leftRows.map((r) => String(r[keyCol])));
  const mapping = [];
  const rightByKey = new Map();
  for (const r of rightRows) {
    const rk = String(r[keyCol]);
    rightByKey.set(rk, r);
    if (leftKeys.has(rk)) mapping.push({ right: rk, left: rk });
  }

  // 左表列全集；右表同名列 → _right 后缀；右表独有列直接并入
  const leftCols = Object.keys(leftRows[0] || {});
  const rightCols = Object.keys(rightRows[0] || {});
  const mergedCols = leftCols.slice();
  const rightRenamed = {};
  for (const rc of rightCols) {
    if (rc === keyCol) continue; // 主键用左表
    if (leftCols.includes(rc)) { rightRenamed[rc] = rc + '_right'; mergedCols.push(rc + '_right'); }
    else if (!mergedCols.includes(rc)) mergedCols.push(rc);
  }

  const merged = leftRows.map((lr) => {
    const out = Object.assign({}, lr);
    const r = rightByKey.get(String(lr[keyCol]));
    if (r) {
      for (const rc of rightCols) {
        if (rc === keyCol) continue;
        const target = rightRenamed[rc] || rc;
        // 左表优先: 左表已有值则保留（冲突列进 _right；独有列直接补）
        out[target] = r[rc];
      }
    }
    return out;
  });

  // 右表独有键的行：spec 未定义，此处仅记录（不并入合并表，进 mapping 之外单独计数）
  const rightOnly = rightRows.filter((r) => !leftKeys.has(String(r[keyCol]))).map((r) => r[keyCol]);

  return {
    ok: true, merged, mapping, rightOnly,
    cols: mergedCols,
    mergedFile: `output/${mergeId}.csv`,
    mappingFile: `output/${mergeId}-mapping.csv`,
  };
}

// ============ 用例 ============
const cases = [
  {
    id: 'normal-merge',
    desc: '正常合并: 重叠键主键替换 + 右表字段补齐（右表独有列并入）',
    left: [
      { customer_id: 'c1', name: 'Alice', city: 'BJ' },
      { customer_id: 'c2', name: 'Bob', city: 'SH' },
      { customer_id: 'c3', name: 'Carol', city: 'GZ' },
      { customer_id: 'c4', name: 'Dave', city: 'SZ' },
    ],
    right: [
      { customer_id: 'c1', vip: 'gold' },
      { customer_id: 'c2', vip: 'silver' },
      { customer_id: 'c5', vip: 'none' }, // 右表独有键
    ],
    key: 'customer_id',
    expect: {
      ok: true,
      merged: [
        { customer_id: 'c1', name: 'Alice', city: 'BJ', vip: 'gold' },
        { customer_id: 'c2', name: 'Bob', city: 'SH', vip: 'silver' },
        { customer_id: 'c3', name: 'Carol', city: 'GZ' },
        { customer_id: 'c4', name: 'Dave', city: 'SZ' },
      ],
      mapping: [{ right: 'c1', left: 'c1' }, { right: 'c2', left: 'c2' }],
    },
  },
  {
    id: 'same-column-conflict',
    desc: '同名列冲突: 左值保留，右值进 _right 后缀',
    left: [{ id: 'p1', name: 'Alpha' }],
    right: [{ id: 'p1', name: 'ALPHA-v2' }],
    key: 'id',
    expect: {
      ok: true,
      merged: [{ id: 'p1', name: 'Alpha', name_right: 'ALPHA-v2' }],
      mapping: [{ right: 'p1', left: 'p1' }],
    },
  },
  {
    id: 'fanout-right',
    desc: 'fan-out 防护: 右表键重复 → 中止，无产物',
    left: [{ id: 'k1', v: 'L1' }, { id: 'k2', v: 'L2' }],
    right: [{ id: 'k1', v: 'R1a' }, { id: 'k1', v: 'R1b' }],
    key: 'id',
    expect: { ok: false, merged: null, mapping: null },
  },
  {
    id: 'fanout-left',
    desc: 'fan-out 防护: 左表键重复 → 中止',
    left: [{ id: 'k1', v: 'L1a' }, { id: 'k1', v: 'L1b' }],
    right: [{ id: 'k1', v: 'R1' }],
    key: 'id',
    expect: { ok: false, merged: null, mapping: null },
  },
  {
    id: 'no-overlap',
    desc: '探索性: 无重叠键 → 记录实际行为（spec 未定义）',
    left: [{ id: 'a1', v: 'L1' }],
    right: [{ id: 'b1', v: 'R1' }],
    key: 'id',
    expect: null, // 不判成立/推翻，只记录
  },
];

const results = { cases: [] };
for (const c of cases) {
  const out = runMerge(c.left, c.right, c.key, c.id);
  let pass = null;
  if (c.expect) {
    const strip = (o) => {
      const s = JSON.parse(JSON.stringify(o));
      delete s.cols; delete s.mergedFile; delete s.mappingFile; delete s.reason; delete s.rightOnly;
      return s;
    };
    pass = JSON.stringify(strip(out)) === JSON.stringify(strip(c.expect));
  }
  results.cases.push({
    id: c.id, desc: c.desc,
    expected: c.expect ? JSON.stringify(c.expect) : '(探索性, 未定义)',
    actual: JSON.stringify(out),
    pass,
  });
}
console.log(JSON.stringify(results, null, 2));
