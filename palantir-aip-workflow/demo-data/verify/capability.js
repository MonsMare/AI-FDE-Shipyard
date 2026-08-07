// verify/capability.js — paip 能力实测脚本（demo-data 全量）
// 输出 JSON 报告：幂等性 / 异常注入零副作用 / schema 推断质量 / 清洗效果
// 运行: node verify/capability.js <company-group 路径>
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const projectDir = process.argv[2] || path.join(__dirname, '..', 'company-group');

const { validateProject } = require('../../bin/validate.js');
const { execProject } = require('../../bin/exec.js');
const { readCsvFile } = require('../../bin/csv.js');

const report = {};

// ---------- 1. 幂等性：连续两次 exec（在副本上跑，避免污染主项目 state/audit） ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-cap-'));
  fs.cpSync(projectDir, tmp, { recursive: true });
  const r1 = execProject(tmp);
  const out1 = fs.existsSync(path.join(tmp, 'output')) ? fs.readdirSync(path.join(tmp, 'output')).filter((f) => f.endsWith('.csv')).length : 0;
  const r2 = execProject(tmp);
  const out2 = fs.existsSync(path.join(tmp, 'output')) ? fs.readdirSync(path.join(tmp, 'output')).filter((f) => f.endsWith('.csv')).length : 0;
  report.idempotency = { firstOk: r1.ok, secondOk: r2.ok, firstOutputCount: out1, secondOutputCount: out2, stable: r1.ok && r2.ok && out1 === out2 };
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- 2. 异常注入：非法 column → 拒绝且零副作用 ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-cap-'));
  fs.cpSync(projectDir, tmp, { recursive: true });
  const tfPath = path.join(tmp, 'approved', 'transforms.json');
  const tf = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
  tf.transforms.push({ id: 'bad_col', source: 'attendance.csv', target: 'x', type: 'lower', rule: { column: 'ghost' }, status: 'approved' });
  fs.writeFileSync(tfPath, JSON.stringify(tf, null, 2));
  const before = fs.existsSync(path.join(tmp, 'output')) ? fs.readdirSync(path.join(tmp, 'output')).length : 0;
  const r = execProject(tmp);
  const after = fs.existsSync(path.join(tmp, 'output')) ? fs.readdirSync(path.join(tmp, 'output')).length : 0;
  report.invalidRule = { ok: r.ok, rejected: !r.ok, outputUnchanged: before === after, problems: (r.problems || []).slice(0, 3) };
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- 3. schema 推断质量（脏数据 → inferredType） ----------
{
  const schemasDir = path.join(projectDir, 'schemas');
  const pick = (file) => {
    const s = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf8'));
    const byName = {};
    for (const c of s.columns) byName[c.name] = { type: c.inferredType, nullRate: +(c.nullCount / c.total).toFixed(3) };
    return byName;
  };
  const attendance = pick('attendance.csv.schema.json');
  const salary = pick('salary_records.csv.schema.json');
  const orders = pick('orders_retail.csv.schema.json');
  report.schemaQuality = {
    attendance_date: attendance.date,          // 三格式日期 → 预期 string（非 date）
    salary_base_salary: salary.base_salary,    // 三格式金额 → 预期 mixed/string
    orders_status: orders.status,              // 状态脏化 → string
    orders_total_amount: orders.total_amount,  // 金额格式 → mixed
  };
}

// ---------- 4. 清洗效果（exec 后残留脏值；副本上跑，保证输出一致） ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paip-cap-'));
  fs.cpSync(projectDir, tmp, { recursive: true });
  const r = execProject(tmp);
  if (!r.ok) {
    report.cleanEffect = { error: 'exec 失败，无法评估清洗效果', problems: (r.problems || []).slice(0, 3) };
  } else {
    const rawAttendance = readCsvFile(path.join(tmp, 'data', 'group', 'attendance.csv'));
    const rawDateIdx = rawAttendance.cols.indexOf('date');
    const rawDirty = rawAttendance.rows.filter((r) => /[0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{2}-[0-9]{2}-[0-9]{4}/.test(r[rawDateIdx])).length;
    const cleaned = readCsvFile(path.join(tmp, 'output', 'date_dmy_to_iso.csv'));
    const cIdx = cleaned.cols.indexOf('date');
    // 注意：date_md_to_iso 与 date_dmy_to_iso 链式，DD-MM-YYYY 应在 dmy 规则后消失
    const dirtyAfter = cleaned.rows.filter((r) => /[0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{2}-[0-9]{2}-[0-9]{4}/.test(r[cIdx])).length;
    const moneyCast = readCsvFile(path.join(tmp, 'output', 'money_cast_number.csv'));
    const mcIdx = moneyCast.cols.indexOf('base_salary');
    const moneyEmpty = moneyCast.rows.filter((r) => r[mcIdx] === '').length;
    report.cleanEffect = {
      dates_before: { total: rawAttendance.rows.length, dirty: rawDirty },
      dates_after_chain: { total: cleaned.rows.length, dirty: dirtyAfter },
      money_cast_empty_after_chain: moneyEmpty, // >0 说明金额脏格式未被清洗规则覆盖（空格千分位）
    };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));
