# 实验：transform-rules-semantics

## 背景与动机
spec §3.1/§3.6 设计 `bin/exec.js` 为纯 JS 行级确定性执行引擎，规则全集为 10 种 type（regex_replace / regex_extract / map / filter / concat / split / cast / lower / upper / trim），语义在 §3.6 表 + §5 错误处理中定义（cast 失败置 null、map 未命中保持原值、filter 保留满足条件行、数组顺序=执行顺序、失败中止零副作用）。
该设计依赖多个未实测的行为断言：
- 10 种规则的**确定性**实现语义与 spec 描述逐字一致（尤其 cast 失败置 null、map 未命中保持原值、regex 语义）
- 链式执行（后规则输入 = 前规则产物）
- 失败中止零副作用（validate 前置失败 → 无 output 写盘、无状态推进、审计只记 exec_failed）——这是 spec 的铁律（§5）
validate-artifacts 实验已证校验逻辑可行，但未测"column 不存在"校验与 exec 集成。

## 待验证假设
- H2a: 10 种规则 type 全部可用纯 JS 行级实现，且输出与 §3.6 定义一致（每规则一组正例 + 反例）
  - H2a 推翻条件: 任一规则的任一用例输出 ≠ spec 预期
- H2b: 链式语义成立（transforms 数组顺序 = 执行顺序，规则 N 看到规则 N-1 的产物）
  - H2b 推翻条件: 顺序执行与声明顺序不符
- H2c: 非法输入时"失败中止、零副作用"成立（column 不存在 / 正则非法 → validate 报错、无 output 文件、state.json 不推进）
  - H2c 推翻条件: 任一非法场景产生部分产物或状态推进

## 变量
- 自变量: 规则 type、输入数据、非法场景注入
- 因变量: 每规则输出值、执行顺序、失败时文件系统状态（output/ 是否有文件、state.json currentStep 是否变化）
- 控制变量: Node 24.15.0、同一份规则实现（scripts 内参考实现，非正式交付）、同一 CSV 输入

## 方法
环境: Node 24.15.0 零依赖。
- 用例: 10 种规则各 ≥2 用例（正例 + 边界反例，覆盖 §3.6 每行语义：regex 全局替换、regex_extract 首组/无组、map 命中/未命中、filter 各 op、concat 多列、split 多目标列、cast 全类型+失败、lower/upper/trim）
- 链式: transforms=[rule1(regex_replace), rule2(lower 作用于 rule1 产物列)]
- 破坏性: ①column 不存在 ②regex pattern 非法 ③approved/ 不存在 —— 各注入后检查 output/ 与 state.json
- 运行: `node scripts/run.js`（输出 JSON：每用例 expected vs actual）

## 成功标准（执行前定义）
- H2a 成立: 全部规则用例 actual === expected
- H2b 成立: 链式输出 === 手算预期
- H2c 成立: 三种非法场景均无 output 文件产生、state.json 无推进
- 任一不满足 → 对应假设推翻

## 偏差自检（设计时填写）
- 预设立场: 10 种规则都是简单的确定性变换，纯 JS 无难度；失败中止也容易实现
- 会打脸的结果: 某个规则的边界语义含糊导致"spec 没说清"（如 cast "true"/"TRUE" 是否都算 boolean、regex_extract 无组时返回全匹配还是 null、split 目标列已存在时行为）——实验会暴露 spec 语义缺口而非实现 bug
- 可能遗漏的数据: 空值/undefined 单元格参与变换（cast null、concat 含 null）的行为 spec 未定义

## 对设计的影响
- H2a/H2b 成立: exec.js 规则实现方案确认
- H2a 推翻: 区分"实现 bug"与"spec 语义缺口"；语义缺口须补 spec §3.6
- H2c 成立: 零副作用铁律的实现路径确认（先校验后执行 + 统一写盘）
- H2c 推翻: spec §5 错误处理设计需要调整
