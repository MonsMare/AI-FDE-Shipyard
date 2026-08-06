// merge-join-sqlite 实验：跨文件 JOIN 合并的可行性
// 验证: 两个独立 CSV 导入 SQLite 后, 能否用 JOIN 实现实体合并(主表为主,副表补齐)
'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

// 模拟 customers.csv 与 orders.csv 导入(表头推断)
db.exec("CREATE TABLE customers (customerId INTEGER, name TEXT, email TEXT)");
db.exec("CREATE TABLE orders (orderId INTEGER, customerId INTEGER, amount REAL)");
db.prepare("INSERT INTO customers VALUES (1,'Alice','alice@example.com'),(2,'Bob','bob@example.com')").run();
db.prepare("INSERT INTO orders VALUES (1001,1,250.5),(1002,1,99.9),(1003,2,430.25)").run();

// 合并: 主表 customers 为主, 副表 orders 聚合(每客户订单数+总额) 补齐
const rows = db.prepare(`
  SELECT c.customerId, c.name, c.email, COUNT(o.orderId) AS orderCount, SUM(o.amount) AS totalAmount
  FROM customers c LEFT JOIN orders o ON c.customerId = o.customerId
  GROUP BY c.customerId, c.name, c.email
`).all();
console.log(JSON.stringify(rows, null, 2));

// 验证: Alice 应有两个订单(250.5+99.9=350.4), Bob 一个(430.25)
const alice = rows.find(r => r.name === 'Alice');
const bob = rows.find(r => r.name === 'Bob');
console.log('Alice orderCount=2:', alice.orderCount === 2, 'total=350.4:', Math.abs(alice.totalAmount - 350.4) < 0.01);
console.log('Bob orderCount=1:', bob.orderCount === 1, 'total=430.25:', Math.abs(bob.totalAmount - 430.25) < 0.01);
