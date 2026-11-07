# 接入外部网络服务（WebDAV / HTTPS / 认证）

以 WebDAV 客户端为例，沉淀接入外部网络服务的通用经验（HTTPS、证书、认证、流式下载、错误分类）。

## 零依赖实现 WebDAV 请求

WebDAV 协议基于 HTTP，可用 Node 内置 `http`/`https` 实现，无需 `webdav` npm 包。

### 认证：Basic Auth

```js
const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
// 请求头
headers: { Authorization: auth }
```

### HTTPS 证书问题（关键坑）

设备系统 CA 证书库过期，Node https 请求外部 HTTPS 服务会因证书校验失败中断。必须：

```js
const https = require('https');
const req = https.request(options, callback);
// options 中：
{ rejectUnauthorized: false }
```

> 这是 NAS 访问外部 WebDAV 服务的常见做法，安全性权衡可接受（NAS 是受控设备）；若目标服务使用有效证书，应移除该选项以恢复证书校验。

### 密码存储

设备无安全加密环境，用 XOR + Base64 混淆存储（非强加密，仅防止明文泄漏）：

```js
const crypto = require('crypto');
const KEY = 'x3p-webdav';

function encrypt(str) {
  const k = Buffer.from(KEY, 'utf8');
  const b = Buffer.from(str, 'utf8');
  for (let i = 0; i < b.length; i++) b[i] = b[i] ^ k[i % k.length];
  return b.toString('base64');
}
function decrypt(enc) {
  if (!enc) return '';
  const b = Buffer.from(enc, 'base64');
  const k = Buffer.from(KEY, 'utf8');
  for (let i = 0; i < b.length; i++) b[i] = b[i] ^ k[i % k.length];
  return b.toString('utf8');
}
```

前端读取配置时**不返回明文密码**，只返回 `hasPassword` 布尔值；编辑时密码留空表示不修改。

## PROPFIND 列目录

WebDAV 列目录用 `PROPFIND` 方法 + `Depth: 1` 头，返回 XML，需解析 `<d:response>` 中的 `href` 和 `resourcetype`（区分文件/目录）。

### href 归一化（关键坑）

WebDAV 返回的 href 可能是相对路径、绝对路径、带或不带 baseUrl 前缀。必须归一化：

```js
function normalizePathSegments(href, baseUrl) {
  // 1. URL 解码
  let p = decodeURIComponent(href);
  // 2. 剥离 baseUrl 前缀
  // 3. 统一为 / 分隔的相对路径
  // 4. 过滤掉"当前目录自身"条目（与父路径相同）
}
```

坑：PROPFIND Depth:1 返回结果里**包含当前目录自身的条目**，若不过滤会导致"当前目录被当成子目录"的解析边界问题。

## GET 流式下载（带进度）

```js
function downloadFile(config, remotePath, downloadId, fileName, targetDir) {
  // 1. 确定目标路径，重名自动追加序号
  // 2. 写 .part 临时文件
  // 3. webdavRequest GET，onData 写流，onProgress 更新进度
  // 4. 完成后 rename .part -> 正式文件
  // 5. 失败时清理 .part
}
```

要点：
- 用 `.part` 临时文件 + 完成后 `rename`，避免下载中断产生损坏文件
- 进度通过 `downloadId` 内存缓存 + 前端轮询 `/api/download/progress?id=xxx` 获取
- 下载超时：连接超时（15s）+ 空闲超时（30s 无数据视为超时）

## 错误分类处理

统一错误码，前端据此显示友好提示：

| 场景 | 判定 | 前端提示 |
|------|------|----------|
| 认证失败 | HTTP 401 | 「用户名或密码错误」 |
| 连接被拒 | ECONNREFUSED | 「无法连接服务器」 |
| DNS 解析失败 | ENOTFOUND | 「服务器地址无法解析」 |
| 网络超时 | 超时事件 | 「连接超时，请检查网络」 |
| 服务器错误 | HTTP 5xx | 「服务器内部错误」 |
| 路径不存在 | HTTP 404 | 「路径不存在」 |

```js
function handleApiError(err, pathname, res) {
  let code = 500, message = '操作失败';
  if (err.code === 'ECONNREFUSED') { code = 502; message = '无法连接服务器'; }
  else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') { code = 502; message = '服务器地址无法解析'; }
  else if (err.statusCode === 401) { code = 401; message = '用户名或密码错误'; }
  else if (err.statusCode === 404) { code = 404; message = '路径不存在'; }
  else if (err.code === 'ETIMEDOUT' || err.code === 'timeout') { code = 504; message = '连接超时'; }
  // ...
  sendJson(res, code, { ok: false, error: message });
}
```

## 多服务器连接管理

当应用需要连接多个外部服务时：

- 配置结构：`{ servers: [ { id, name, baseUrl, username, passwordEnc, createdAt, updatedAt } ] }`
- 每个服务器独立存储密码（各自 passwordEnc）
- 前端首页展示服务器列表，点击进入浏览
- 后端按 `serverId` 或 `baseUrl` 查找对应配置
- 旧版单条配置自动迁移为列表（见 deployment.md）
