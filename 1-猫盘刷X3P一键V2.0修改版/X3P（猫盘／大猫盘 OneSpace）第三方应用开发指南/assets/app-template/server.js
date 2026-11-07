/**
 * X3P 第三方应用 —— 后端服务模板（Node v6 兼容，零依赖）
 *
 * 兼容约束（设备预装 Node v6.7.0）：
 *  - 无 async/await、无对象展开 {...}、无可选链 ?.、无空值合并 ??
 *  - 无 fs.mkdirSync(dir, {recursive})
 *  - url.parse 返回 null 字段，拼接前必须 || '' / || '/' 兜底
 *
 * 依赖：仅 Node 内置模块（http / https / url / fs / path / crypto）
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8899;
const HOST = process.env.HOST || '0.0.0.0';
const APP_DIR = process.env.X3P_APP_DIR || __dirname;
const CONFIG_FILE = path.join(APP_DIR, 'config', 'config.json');
const WEB_DIR = path.join(APP_DIR, 'web');

// ---------------------------------------------------------------------------
// Node v6 兼容工具
// ---------------------------------------------------------------------------

// url.parse 结果字段可能为 null，统一兜底
function parseUrl(u) {
  const parsed = url.parse(String(u));
  if (parsed.pathname === null || parsed.pathname === undefined) parsed.pathname = '/';
  return parsed;
}

// 递归创建目录（v6 不支持 mkdirSync recursive）
function ensureDir(dir) {
  if (!dir) return;
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  if (parent && parent !== dir) ensureDir(parent);
  try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// 读取请求体（Promise）
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (chunk) { data += chunk; });
    req.on('end', function () {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 静态文件服务（web/ 目录）
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(WEB_DIR, rel);
  // 防止路径穿越
  if (filePath.indexOf(WEB_DIR) !== 0) {
    sendJson(res, 403, { ok: false, error: '禁止访问' });
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------
const server = http.createServer(function (req, res) {
  const parsed = parseUrl(req.url);
  const pathname = parsed.pathname;

  // 静态文件
  if (req.method === 'GET' && serveStatic(req, res, pathname)) return;

  // API 路由（示例）
  readBody(req).then(function (body) {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, message: 'ok' });
    }
    // TODO: 在这里添加你的 API 路由

    return sendJson(res, 404, { ok: false, error: '接口不存在：' + pathname });
  });
});

server.listen(PORT, HOST, function () {
  console.log('X3P app listening on ' + HOST + ':' + PORT);
});
