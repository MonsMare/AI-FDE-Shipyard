// validate-artifacts 实验：校验器核心逻辑可行性
// 验证: 用现有 approved/ 产物结构, 能否实现"格式先于执行"校验(对象有主键/链接两端存在/转换type合法/合并confidence)
'use strict';
const fs = require('fs');

function validate(projectDir) {
  const problems = [];
  const read = (f) => { try { return JSON.parse(fs.readFileSync(`${projectDir}/${f}`, 'utf8')); } catch { problems.push(`缺少/损坏 ${f}`); return null; } };
  const objects = read('approved/objects.json');
  const links = read('approved/links.json');
  const transforms = read('approved/transforms.json');
  const merges = read('approved/merges.json');
  if (objects) {
    for (const o of objects.objects) {
      if (!o.id || !o.displayName) problems.push(`对象缺 id/displayName: ${JSON.stringify(o.id)}`);
      if (!o.properties || !o.properties.some(p => p.primaryKey)) problems.push(`对象缺主键: ${o.id}`);
    }
  }
  if (links) {
    const ids = new Set(objects?.objects.map(o => o.id) || []);
    for (const l of links.links) {
      if (!ids.has(l.left) || !ids.has(l.right)) problems.push(`链接两端对象不存在: ${l.id} (${l.left}→${l.right})`);
      if (!['1:1','1:N','N:M'].includes(l.cardinality)) problems.push(`cardinality 非法: ${l.id}`);
    }
  }
  if (transforms) {
    const VALID = ['regex_replace','regex_extract','map','filter','concat','split','cast','lower','upper','trim'];
    for (const t of transforms.transforms) {
      if (!VALID.includes(t.type)) problems.push(`转换 type 非法: ${t.id} (${t.type})`);
      if (!t.rule || typeof t.rule !== 'object') problems.push(`转换缺 rule: ${t.id}`);
    }
  }
  if (merges) {
    for (const m of merges.merges) {
      if (!(m.confidence >= 0 && m.confidence <= 1)) problems.push(`confidence 越界: ${m.id}`);
    }
  }
  return problems;
}

// 测试1: 合法产物（构造最小合法对象/链接/转换/合并）
const tmp = require('os').tmpdir() + '/valtest';
fs.mkdirSync(tmp + '/approved', { recursive: true });
fs.writeFileSync(tmp + '/approved/objects.json', JSON.stringify({objects:[{id:'Customer',displayName:'客户',properties:[{id:'customerId',primaryKey:true}]}]}));
fs.writeFileSync(tmp + '/approved/links.json', JSON.stringify({links:[{id:'L1',left:'Customer',right:'Customer',cardinality:'1:N'}]}));
fs.writeFileSync(tmp + '/approved/transforms.json', JSON.stringify({transforms:[{id:'T1',type:'regex_replace',rule:{}}]}));
fs.writeFileSync(tmp + '/approved/merges.json', JSON.stringify({merges:[{id:'M1',confidence:0.95}]}));
console.log('合法产物 → 问题数:', validate(tmp).length, '(期望 0)');

// 测试2: 非法产物（缺主键/链接指向不存在/type非法/confidence越界）
fs.writeFileSync(tmp + '/approved/objects.json', JSON.stringify({objects:[{id:'X',displayName:'X',properties:[]}]}));
fs.writeFileSync(tmp + '/approved/links.json', JSON.stringify({links:[{id:'L2',left:'Ghost',right:'X',cardinality:'1:X'}]}));
fs.writeFileSync(tmp + '/approved/transforms.json', JSON.stringify({transforms:[{id:'T2',type:'magic',rule:{}}]}));
fs.writeFileSync(tmp + '/approved/merges.json', JSON.stringify({merges:[{id:'M2',confidence:1.5}]}));
const bad = validate(tmp);
console.log('非法产物 → 问题数:', bad.length, '(期望 4)');
bad.forEach(b => console.log('  ✘', b));
