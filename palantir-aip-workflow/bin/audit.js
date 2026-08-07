#!/usr/bin/env node
// audit.js — Ontology 流水线审计与状态机校验
// 子命令:
//   node audit.js log <projectDir> <step> <action> <target> [detail]
//      追加一条审计事件并更新 state.json
//   node audit.js state <projectDir>
//      打印当前流水线状态
//   node audit.js step <projectDir> <nextStep>
//      校验并推进状态机（init→source→infer→model→entity→review→exec）
//   node audit.js check <projectDir>
//      校验项目完整性（目录/文件存在、状态机一致性）
// 零依赖，Node 18+。
'use strict';

const fs = require('fs');
const path = require('path');

const STEPS = ['init', 'source', 'infer', 'model', 'entity', 'review', 'exec'];
const FAIL = 1;

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`无法读取 ${p}: ${e.message}`);
    process.exit(FAIL);
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function appendEvent(projectDir, evt) {
  const auditDir = path.join(projectDir, 'audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(path.join(auditDir, 'audit.jsonl'), JSON.stringify(evt) + '\n');
}

function bumpState(projectDir, state, step, action, target, detail, touchSteps) {
  state.lastEventId = (state.lastEventId || 0) + 1;
  const evt = {
    id: state.lastEventId,
    ts: new Date().toISOString(),
    step,
    action,
    target: target || '',
    detail: detail || '',
  };
  appendEvent(projectDir, evt);
  // 仅 step 命令允许改动 steps 状态机；log 只追加事件
  if (touchSteps && state.steps && step in state.steps) {
    state.steps[step] = action === 'step_completed' ? 'done' : 'pending';
  }
  return evt;
}

function cmdLog(args) {
  const [projectDir, step, action, target, ...rest] = args;
  if (!projectDir || !step || !action) {
    console.error('用法: audit.js log <projectDir> <step> <action> <target> [detail]');
    process.exit(FAIL);
  }
  const statePath = path.join(projectDir, 'state.json');
  const state = readJson(statePath);
  const evt = bumpState(projectDir, state, step, action, target || '', rest.join(' ') || '', false);
  writeJson(statePath, state);
  console.log(`#${evt.id} ${step}/${action} → ${evt.target}`);
}

function cmdState(args) {
  const [projectDir] = args;
  if (!projectDir) { console.error('用法: audit.js state <projectDir>'); process.exit(FAIL); }
  const state = readJson(path.join(projectDir, 'state.json'));
  console.log(JSON.stringify({ currentStep: state.currentStep, steps: state.steps, stats: state.stats }, null, 2));
}

function cmdStep(args) {
  const [projectDir, nextStep] = args;
  if (!projectDir || !nextStep) { console.error('用法: audit.js step <projectDir> <nextStep>'); process.exit(FAIL); }
  if (!STEPS.includes(nextStep)) { console.error(`未知步骤: ${nextStep}（可用: ${STEPS.join(' → ')}）`); process.exit(FAIL); }
  const statePath = path.join(projectDir, 'state.json');
  const state = readJson(statePath);
  const curIdx = STEPS.indexOf(state.currentStep);
  const nextIdx = STEPS.indexOf(nextStep);
  if (nextIdx !== curIdx + 1) {
    console.error(`状态机不允许 ${state.currentStep} → ${nextStep}（必须按顺序推进）`);
    process.exit(FAIL);
  }
  state.currentStep = nextStep;
  state.steps[nextStep] = 'in_progress';
  const evt = bumpState(projectDir, state, nextStep, 'step_entered', '', `进入 ${nextStep}`, false);
  writeJson(statePath, state);
  console.log(`状态机推进: ${state.currentStep}（步骤: ${nextStep}）`);
}

function cmdCheck(args) {
  const [projectDir] = args;
  if (!projectDir) { console.error('用法: audit.js check <projectDir>'); process.exit(FAIL); }
  const problems = [];
  // audit/ 目录由首次 log 自动创建，不要求预先存在
  const required = ['config.json', 'state.json'];
  for (const f of required) {
    if (!fs.existsSync(path.join(projectDir, f))) problems.push(`缺少 ${f}`);
  }
  if (problems.length === 0) {
    const state = readJson(path.join(projectDir, 'state.json'));
    if (!STEPS.includes(state.currentStep)) problems.push(`state.json 的 currentStep 非法: ${state.currentStep}`);
    for (const s of STEPS) {
      if (!state.steps || !(s in state.steps)) problems.push(`state.json 缺步骤 ${s}`);
    }
  }
  if (problems.length === 0) {
    console.log('✔ 项目结构完整，状态机一致');
  } else {
    console.error('✘ 检查发现问题:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(FAIL);
  }
}

const cmd = process.argv[2];
const rest = process.argv.slice(3);

// ==== 模块接口（供 exec.js 等引擎脚本复用，保证 lastEventId 递增一致） ====

// 追加审计事件并更新 state.json。返回事件对象。
function addEvent(projectDir, step, action, target, detail) {
  const statePath = path.join(projectDir, 'state.json');
  const state = readJson(statePath);
  const evt = bumpState(projectDir, state, step, action, target || '', detail || '', false);
  writeJson(statePath, state);
  return evt;
}

// 推进状态机到 nextStep（严格顺序）。成功返回 true；不允许时返回 false 且不写任何东西。
function stepTo(projectDir, nextStep) {
  if (!STEPS.includes(nextStep)) return false;
  const statePath = path.join(projectDir, 'state.json');
  const state = readJson(statePath);
  const curIdx = STEPS.indexOf(state.currentStep);
  const nextIdx = STEPS.indexOf(nextStep);
  if (nextIdx !== curIdx + 1) return false;
  state.currentStep = nextStep;
  state.steps[nextStep] = 'in_progress';
  const evt = bumpState(projectDir, state, nextStep, 'step_entered', '', `进入 ${nextStep}`, false);
  writeJson(statePath, state);
  return evt ? true : false;
}

function cmdExec(args) {
  const [projectDir, status, ...rest] = args;
  if (!projectDir || !status) {
    console.error('用法: audit.js exec <projectDir> <executed|failed> [detail]');
    process.exit(FAIL);
  }
  const detail = rest.join(' ');
  if (status === 'executed') {
    addEvent(projectDir, 'exec', 'exec_completed', '', detail);
    console.log(`✔ exec_completed 已记录${detail ? `（${detail}）` : ''}`);
  } else if (status === 'failed') {
    addEvent(projectDir, 'exec', 'exec_failed', '', detail);
    console.log(`✔ exec_failed 已记录${detail ? `（${detail}）` : ''}`);
  } else {
    console.error(`未知 exec 状态: ${status}（可用: executed|failed）`);
    process.exit(FAIL);
  }
}

function main() {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  switch (cmd) {
    case 'log': cmdLog(rest); break;
    case 'state': cmdState(rest); break;
    case 'step': cmdStep(rest); break;
    case 'exec': cmdExec(rest); break;
    case 'check': cmdCheck(rest); break;
    default:
      console.error('用法: audit.js <log|state|step|exec|check> ...');
      process.exit(FAIL);
  }
}

if (require.main === module) main();

module.exports = { addEvent, stepTo, STEPS };
