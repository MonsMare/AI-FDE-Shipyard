# 实验报告：merge-join-sqlite

## 结论
H1 **成立**：两个独立 CSV 导入 SQLite 内存表后，用 LEFT JOIN + GROUP BY 可实现实体合并（主表为主、副表聚合补齐），输出正确。

## 结果数据
| 客户 | 订单数 | 总金额 | 期望 | 结果 |
|---|---|---|---|---|
| Alice | 2 | 350.4 | 2 / 350.4 | ✓ |
| Bob | 1 | 430.25 | 1 / 430.25 | ✓ |

## 与假设对照
- H1（SQLite JOIN 跨文件合并可行）：数据 → **成立**。LEFT JOIN 保主表全部行（无订单客户不丢），聚合列正确。

## 对设计的影响
- exec.js 的合并执行路径确认：先导入两表 → LEFT JOIN + GROUP BY 生成合并结果 → 物化 CSV。无退化。
- 注意：LEFT JOIN 对"副表有多行"的客户产生多行（本例用 GROUP BY 聚合规避）；若合并语义是"副表取首行"，需 ROW_NUMBER 或子查询——设计时明确语义。
- 设计补充：合并结果输出含聚合列（orderCount/totalAmount），作为物化 CSV 的自然形态；主键归并体现为 customerId 唯一。

## 局限与后续
- 未测：3+ 源合并（JOIN 链）、副表首行语义（非聚合）。
- 未测：大数据量 JOIN 性能（内存库上亿行级边界）。

## 环境
- 日期：2026-08-05
- 环境：Node 24.15.0，node:sqlite（DatabaseSync）
- 复现：`node scripts/run.js`（本目录）
