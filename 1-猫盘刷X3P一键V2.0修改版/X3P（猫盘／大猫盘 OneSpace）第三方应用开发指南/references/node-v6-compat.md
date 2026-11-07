# Node.js v6 兼容开发要点与常见坑

X3P 设备预装 **Node.js v6.7.0**（`/usr/bin/node`，aarch64 编译）。后端代码必须兼容 v6，否则运行时报错。以下是在真实开发中踩过并验证的坑。

## 必须避免的语法（v8+ / ES2017+ 特性）

| 特性 | v6 支持 | 替代方案 |
|------|---------|----------|
| `async` / `await` | ❌ | Promise 链（`.then().catch()`） |
| 对象展开 `{...obj}` | ❌ | `Object.assign({}, obj)` |
| 数组展开 `[...arr]` | ❌ | `arr.slice()` / `arr.concat()` |
| 可选链 `?.` | ❌ | `obj && obj.x` |
| 空值合并 `??` | ❌ | `a != null ? a : b` |
| `fs.mkdirSync(dir, {recursive:true})` | ❌（recursive 参数 v10.12+） | 手写递归 mkdir |
| `String.prototype.padStart/padEnd` | ❌（v8+） | 手写补零 |
| `Array.prototype.flat` | ❌（v11+） | 手写展开 |
| `Object.fromEntries` | ❌ | 手写构造 |

**v6 支持、可放心使用**：`const`/`let`、箭头函数、模板字符串、`for...of`、`Promise`、`Map`/`Set`、`Object.assign`、`Array.prototype.find`/`includes`/`filter`/`map`/`reduce`、`path`/`fs`/`url`/`crypto` 内置模块。

## 坑 1：`new URL()` 不存在

```js
// ❌ v6 报错：URL is not a constructor
const u = new URL('https://host/path');

// ✅ 用 url.parse + 自定义辅助
const url = require('url');
function parseUrl(u) {
  const parsed = url.parse(String(u));
  if (parsed.pathname === null || parsed.pathname === undefined) parsed.pathname = '/';
  return parsed;
}
```

## 坑 2：`url.parse` 返回 null 字段（核心坑）

Node v6 的 `url.parse` 对**缺失的字段返回 `null` 而非空字符串**。直接拼接会把 `"null"` 字符串拼进 URL：

```js
// ❌ 坑：无 query 时 parsed.search 为 null
const target = parsed.pathname + parsed.search;   // → "/path" + null = "/pathnull"

// ✅ 正确：用 || '' 兜底
const target = parsed.pathname + (parsed.search || '');
```

**受影响字段**：`search`、`pathname`、`path`、`query`（无 query 时均为 null）。

典型故障现象：WebDAV 服务收到 `PROPFIND /null` 返回 404，排查半天才发现是 `pathname + null` 拼出来的。

## 坑 3：无路径 baseUrl 丢失尾斜杠

```js
// ❌ 坑：basePath = '/'.replace(/\/+$/, '') 变成空字符串
let basePath = baseUrl.replace(/\/+$/, '');
// ✅ 空则回退为 '/'
if (basePath === '') basePath = '/';
```

## 手写递归 mkdir（替代 recursive 参数）

```js
function ensureDir(dir) {
  if (!dir) return;
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  if (parent && parent !== dir) ensureDir(parent);
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
```

## 零依赖原则

设备离线、无 npm，后端只允许用 Node 内置模块（`http`/`https`/`url`/`fs`/`path`/`crypto`）。不要引入任何 npm 依赖（除非能保证联网 install 并处理 ARM64 原生模块编译问题）。

## 语法检查方法

本机（开发机）有新版 Node，可用 `node --check` 做语法检查，但**这不能发现 v6 兼容问题**（新版 Node 能通过所有 v6 语法）。真正的兼容验证只能靠部署到设备后实测，或本机安装 nvm 切换 v6 测试。

关键自检清单（写完代码后逐项过）：
1. 无 `async`/`await`？
2. 无对象/数组展开 `...`？
3. 无可选链 `?.`、空值合并 `??`？
4. 无 `mkdirSync(..., {recursive})`？
5. 所有 `url.parse` 结果字段拼接前都做了 `|| ''` / `|| '/'` 兜底？
6. 无 `padStart`/`flat`/`Object.fromEntries`？

## HTTPS 证书问题

设备系统 CA 库过期，Node https 请求外部服务会因证书校验失败中断。接入外部 WebDAV 等 HTTPS 服务时需：

```js
const req = https.request(options, callback);
// options 中设置
rejectUnauthorized: false
```

详见 `network-services.md`。
