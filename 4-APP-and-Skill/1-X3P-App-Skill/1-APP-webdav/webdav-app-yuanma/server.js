/**
 * X3P WebDAV 客户端 —— 后端服务
 *
 * 功能：
 *  - 管理多个 WebDAV 服务器连接配置（地址、账号、密码、备注名）
 *  - 连接测试（PROPFIND 根目录）
 *  - 列出目录与文件（PROPFIND Depth:1）
 *  - 下载远程文件到本地存储（GET + 进度上报，支持自定义本地目录）
 *  - 浏览本地存储目录（供下载路径选择）
 *  - 统一错误处理：连接失败 / 认证失败(401) / 网络超时 / 服务器错误
 *
 * 依赖：仅使用 Node.js 内置模块（http / https / url / fs / path / crypto），
 *      无需 npm install 即可运行，适配 X3P 设备离线部署。
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Node v6 兼容：url.parse 返回的对象没有 origin 字段，这里统一用 parse
// 提供与 new URL() 相近的字段访问（protocol/hostname/port/pathname/search）
function parseUrl(u) {
  const parsed = url.parse(String(u));
  // url.parse 的 pathname 可能为 null（当只有 host 时），统一兜底
  if (parsed.pathname === null || parsed.pathname === undefined) parsed.pathname = '/';
  return parsed;
}

// 从已解析的 url 对象推导 origin（scheme://host[:port]）
function urlOrigin(parsed) {
  const port = parsed.port ? (':' + parsed.port) : '';
  return (parsed.protocol || 'http:') + '//' + (parsed.hostname || '') + port;
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8899;
const HOST = process.env.HOST || '0.0.0.0';

// 应用工作目录（存放配置与下载文件），可被环境变量覆盖
const APP_DIR = process.env.X3P_APP_DIR || __dirname;

// 配置文件与下载目录
const CONFIG_FILE = path.join(APP_DIR, 'config', 'webdav-config.json');
const DOWNLOAD_DIR = process.env.X3P_DOWNLOAD_DIR || path.join(APP_DIR, 'downloads');

// 本地存储根目录（文件管理器所展示），供下载路径选择
// 公共目录：文件管理器 c=10，path 前缀 "public/"
const LOCAL_ROOT = process.env.X3P_LOCAL_ROOT || '/sata/public';
// 我的文件（用户主目录）：文件管理器 c=0，path 前缀 "/"
const HOME_ROOT = process.env.X3P_HOME_ROOT || '/sata/home/admin';

// 下载历史记录文件（持久化已完成下载的元信息：完成时间、用时、来源服务器等）
const HISTORY_FILE = path.join(APP_DIR, 'config', 'download-history.json');

// 应用元数据（与 X3P 应用中心读取的是同一个文件，保证版本号只有一处来源）
const APP_CONF_FILE = path.join(APP_DIR, 'app', 'conf.js');
const FALLBACK_NAME = 'Webdav云盘';

// 读取应用版本：优先 app/conf.js，其次 package.json，最后兜底
function readAppVersion() {
  try {
    const conf = JSON.parse(fs.readFileSync(APP_CONF_FILE, 'utf8'));
    if (conf && conf.ver) {
      return { ver: String(conf.ver), verno: conf.verno || 0, name: conf.name || FALLBACK_NAME };
    }
  } catch (e) { /* conf.js 不存在或格式异常，走回退 */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    if (pkg && pkg.version) {
      return { ver: String(pkg.version), verno: 0, name: FALLBACK_NAME };
    }
  } catch (e2) { /* 无 package.json 时忽略 */ }
  return { ver: '1.0', verno: 0, name: FALLBACK_NAME };
}

// 单次下载超时 / 连接超时（毫秒）
const CONNECT_TIMEOUT = 15000;
const DOWNLOAD_TIMEOUT = 0; // 0 表示不限制整体下载时长，仅限制空闲超时
const IDLE_TIMEOUT = 30000; // 下载时超过 30s 无数据视为超时

// 下载进度缓存：downloadId -> { received, total, done, error, filePath }
const downloadJobs = new Map();

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!dir) return;
  if (fs.existsSync(dir)) return;
  // 递归创建父目录（Node v6 不支持 recursive 参数，手动实现）
  const parent = path.dirname(dir);
  if (parent && parent !== dir) ensureDir(parent);
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

// 读取配置。返回 { servers: [ {id, name, baseUrl, username, passwordEnc, createdAt, updatedAt} ] }
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // 兼容旧版单条配置 {baseUrl, username, passwordEnc} -> 迁移为列表
      if (data && data.baseUrl && !Array.isArray(data.servers)) {
        return {
          servers: [{
            id: 'default',
            name: 'WebDAV',
            baseUrl: data.baseUrl,
            username: data.username || '',
            passwordEnc: data.passwordEnc || '',
            createdAt: data.updatedAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
          }],
        };
      }
      if (data && Array.isArray(data.servers)) return data;
    }
  } catch (e) {
    console.error('[config] 读取配置失败:', e.message);
  }
  return { servers: [] };
}

// 保存配置
function saveConfig(config) {
  ensureDir(path.dirname(CONFIG_FILE));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// 读取下载历史记录（数组）
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {
    console.error('[history] 读取下载历史失败:', e.message);
  }
  return [];
}

// 保存下载历史记录
function saveHistory(history) {
  ensureDir(path.dirname(HISTORY_FILE));
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

// 追加一条下载历史记录
function appendHistory(record) {
  const history = loadHistory();
  history.unshift(record);
  // 最多保留 500 条，避免文件无限膨胀
  if (history.length > 500) history.length = 500;
  saveHistory(history);
}

// 读取下载目录配置（存于主配置文件 config.downloadDir）
function loadDownloadDir() {
  const cfg = loadConfig();
  if (cfg && cfg.downloadDir && String(cfg.downloadDir).trim()) {
    return String(cfg.downloadDir).trim();
  }
  return '';
}

// 保存下载目录配置
function saveDownloadDir(dir) {
  const cfg = loadConfig();
  cfg.downloadDir = String(dir || '').trim();
  saveConfig(cfg);
}

// 简单加密存储密码（XOR + base64，避免明文；非强加密，仅防直接查看）
function encrypt(text) {
  const key = 'x3p-webdav-salt-v1';
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(out, 'binary').toString('base64');
}

function decrypt(b64) {
  try {
    const text = Buffer.from(b64, 'base64').toString('binary');
    const key = 'x3p-webdav-salt-v1';
    let out = '';
    for (let i = 0; i < text.length; i++) {
      out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  } catch (e) {
    return '';
  }
}

// 规范化服务器地址：自动补全协议头与去除末尾斜杠
function normalizeBaseUrl(input) {
  let s = (input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    s = 'http://' + s;
  }
  // 去除末尾多余斜杠
  s = s.replace(/\/+$/, '');
  return s;
}

// 解析 WebDAV 目标 URL（合并 baseUrl 与相对路径，并做路径编码）
function buildTargetUrl(baseUrl, remotePath) {
  const base = parseUrl(baseUrl);
  // 将 remotePath 拆分为段并逐段编码（保留斜杠），避免中文/空格问题
  const segments = String(remotePath || '').split('/').filter((s) => s.length > 0);
  const encodedPath = segments.map((seg) => encodeURIComponent(seg)).join('/');
  // basePath：去掉末尾斜杠（但保留根目录的单个 '/')
  let basePath = (base.pathname || '/').replace(/\/+$/, '');
  if (basePath === '') basePath = '';
  // 拼接时避免出现双斜杠：basePath 已以 '/' 结尾或为空时，只补一个 '/'。
  // 例：basePath='/' + '/test' 会产生 '//test'（会被部分服务重定向/405），这里统一规范化。
  let fullPath = basePath;
  if (encodedPath) {
    fullPath = basePath.replace(/\/+$/, '') + '/' + encodedPath;
  }
  // 根路径必须保留一个前导斜杠
  if (fullPath === '') fullPath = '/';
  if (fullPath.charAt(0) !== '/') fullPath = '/' + fullPath;
  // 用 pathname + search 重组为完整 URL（保留 baseUrl 的协议与 host）
  return urlOrigin(base) + fullPath + (base.search || '');
}

// 构造 Basic Auth 头
function basicAuthHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return 'Basic ' + token;
}

// ---------------------------------------------------------------------------
// WebDAV 底层请求（返回 Promise）
// ---------------------------------------------------------------------------
function webdavRequest(options) {
  const {
    baseUrl,
    remotePath,
    targetUrl,       // 支持传入完整 URL（重定向时使用）
    username,
    password,
    method = 'PROPFIND',
    depth = '1',
    timeout = CONNECT_TIMEOUT,
    onData,          // 可选，流式下载数据回调
    onProgress,      // 可选，下载进度回调 { received, total }
    ctrl,            // 可选，控制对象，用于取消/暂停下载（写入 req/res 引用）
    redirectCount = 0,
  } = options;

  return new Promise((resolve, reject) => {
    const target = targetUrl || buildTargetUrl(baseUrl, remotePath);
    let parsed;
    try {
      parsed = parseUrl(target);
    } catch (e) {
      return reject(makeError('invalid_url', '服务器地址格式不正确'));
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };
    if (method === 'PROPFIND') {
      headers['Depth'] = depth;
    }
    if (username !== undefined && username !== null && username !== '') {
      headers['Authorization'] = basicAuthHeader(username, password || '');
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);

    const reqOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + (parsed.search || ''),
      method,
      headers,
    };
    // 设备系统 CA 证书库可能过期，导致 HTTPS 证书校验失败。
    // 对 HTTPS 请求放宽证书校验，避免误报（NAS 访问外部 WebDAV 常见场景）。
    if (isHttps) {
      reqOptions.rejectUnauthorized = false;
    }
    const req = lib.request(
      reqOptions,
      (res) => {
        // 暴露请求/响应对象给调用方，用于取消/暂停
        if (ctrl) {
          ctrl.req = req;
          ctrl.res = res;
          ctrl.pause = function () { if (res && res.pause) res.pause(); };
          ctrl.resume = function () { if (res && res.resume) res.resume(); };
          ctrl.cancel = function () { try { req.destroy(); } catch (e) {} try { if (res) res.destroy(); } catch (e) {} };
        }
        const status = res.statusCode;

        // 重定向处理（301, 302, 303, 307, 308）
        // 必须优先于状态码检查：网盘服务（如 6盘、Alist 等）下载时会 302 重定向到 CDN 预签名下载地址
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= 5) {
            return reject(makeError('redirect_loop', '重定向次数过多（已超过 5 次）'));
          }
          const loc = res.headers.location;
          let nextUrl;
          try {
            nextUrl = url.resolve(target, loc);
          } catch (e) {
            return reject(makeError('invalid_redirect', '重定向地址解析失败：' + loc));
          }
          const nextParsed = parseUrl(nextUrl);
          const origParsed = parsed;

          // 判断是否跨域（协议、主机、端口是否有任一不同）
          const isCrossOrigin = (
            nextParsed.protocol !== origParsed.protocol ||
            nextParsed.hostname !== origParsed.hostname ||
            (nextParsed.port || (nextParsed.protocol === 'https:' ? '443' : '80')) !==
              (origParsed.port || (origParsed.protocol === 'https:' ? '443' : '80'))
          );

          const retryOpts = Object.assign({}, options, {
            targetUrl: nextUrl,
            baseUrl: undefined,
            remotePath: undefined,
            redirectCount: redirectCount + 1,
            // 301/302/303 遵循标准重定向规范，后续下载请求转为 GET
            method: 'GET',
          });

          // 跨域重定向时必须剥离 Authorization 凭据，防止账号密码泄露给 CDN，
          // 并且避免 CDN/对象存储因为携带无效 Basic Auth 产生 403 Forbidden 鉴权失败
          if (isCrossOrigin) {
            delete retryOpts.username;
            delete retryOpts.password;
          }

          return resolve(webdavRequest(retryOpts));
        }

        // 处理认证失败与拒绝访问
        if (status === 401) {
          res.resume();
          return reject(makeError('auth_failed', '认证失败：账号或密码错误（HTTP 401）', 401));
        }
        if (status === 403) {
          res.resume();
          return reject(makeError('forbidden', '访问被拒绝：没有权限或防盗链/签名失效（HTTP 403）', 403));
        }
        // 404 视为目录不存在或路径错误
        if (status === 404) {
          res.resume();
          return reject(makeError('not_found', '路径不存在或已被移除（HTTP 404）'));
        }
        // 其他非 2xx 错误
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(makeError('server_error', '服务器返回错误（HTTP ' + status + '）', status));
        }

        // 流式下载（GET）
        if (onData) {
          const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
          let received = 0;
          let lastDataTime = Date.now();

          const idleTimer = IDLE_TIMEOUT
            ? setInterval(() => {
                if (Date.now() - lastDataTime > IDLE_TIMEOUT) {
                  req.destroy();
                  reject(makeError('timeout', '下载超时：网络连接中断或无数据'));
                }
              }, 5000)
            : null;

          res.on('data', (chunk) => {
            received += chunk.length;
            lastDataTime = Date.now();
            onData(chunk);
            if (onProgress) onProgress({ received, total });
          });
          res.on('end', () => {
            if (idleTimer) clearInterval(idleTimer);
            resolve({ status, total, received });
          });
          res.on('error', (err) => {
            if (idleTimer) clearInterval(idleTimer);
            reject(makeError('network', '下载过程中网络错误：' + err.message));
          });
          return;
        }

        // 非流式：收集响应体（PROPFIND 等）
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ status, headers: res.headers, body });
        });
        res.on('error', (err) => reject(makeError('network', '读取响应失败：' + err.message)));
      }
    );

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(makeError('timeout', '连接超时：无法在 ' + timeout / 1000 + ' 秒内完成请求'));
    });

    req.on('error', (err) => {
      // 区分常见网络错误
      if (err.code === 'ENOTFOUND') {
        reject(makeError('dns', '无法解析服务器地址，请检查地址是否正确'));
      } else if (err.code === 'ECONNREFUSED') {
        reject(makeError('connection', '连接被拒绝，服务器未运行或端口错误'));
      } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
        reject(makeError('timeout', '连接超时，请检查网络或服务器地址'));
      } else if (err.code === 'ECONNRESET') {
        reject(makeError('connection', '连接被重置，请检查网络'));
      } else {
        reject(makeError('connection', '连接失败：' + (err.message || '未知错误')));
      }
    });

    req.end();
  });
}

function makeError(code, message, httpStatus) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus || 0;
  return e;
}

// ---------------------------------------------------------------------------
// PROPFIND 响应解析（解析 XML，提取 href / displayname / resourcetype / 大小）
// ---------------------------------------------------------------------------
function parsePropfind(body) {
  const xml = body.toString('utf8');
  const items = [];
  // 使用正则提取每个 <d:response> ... </d:response>（兼容带/不带命名空间前缀）
  const responseRegex = /<[^>]*:?response[^>]*>([\s\S]*?)<\/[^>]*:?response>/gi;
  let m;
  while ((m = responseRegex.exec(xml)) !== null) {
    const block = m[1];

    const hrefMatch = block.match(/<[^>]*:?href[^>]*>([\s\S]*?)<\/[^>]*:?href>/i);
    const nameMatch = block.match(/<[^>]*:?displayname[^>]*>([\s\S]*?)<\/[^>]*:?displayname>/i);
    const isCollection = /<[^>]*:?resourcetype[^>]*>[\s\S]*?<[^>]*:?collection/i.test(block);
    const sizeMatch = block.match(/<[^>]*:?getcontentlength[^>]*>(\d+)<\/[^>]*:?getcontentlength>/i);
    const modifiedMatch = block.match(/<[^>]*:?getlastmodified[^>]*>([\s\S]*?)<\/[^>]*:?getlastmodified>/i);
    const contentTypeMatch = block.match(/<[^>]*:?getcontenttype[^>]*>([\s\S]*?)<\/[^>]*:?getcontenttype>/i);

    if (!hrefMatch) continue;

    let href = hrefMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x2F;/g, '/');
    // 解码百分号编码（保留 UTF-8）
    try {
      href = decodeURIComponent(href);
    } catch (e) {
      /* 忽略解码失败 */
    }

    const rawName = nameMatch ? nameMatch[1] : null;
    // 文件名优先用 displayname，否则从 href 末尾解析
    let name = rawName ? rawName.replace(/&amp;/g, '&') : '';
    if (!name) {
      const parts = href.replace(/\/+$/, '').split('/');
      name = decodeURIComponent(parts[parts.length - 1] || '');
    }

    items.push({
      href,
      name,
      isDir: isCollection,
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      modified: modifiedMatch ? modifiedMatch[1] : '',
      contentType: contentTypeMatch ? contentTypeMatch[1] : '',
    });
  }
  return items;
}

// 将服务器返回的 href（可能是绝对 URL，也可能是相对于 WebDAV 根的路径）
// 归一化为相对路径段。策略：若为绝对 URL，取其 pathname；然后剥掉 baseUrl 的
// pathname 前缀，得到相对路径。无法剥离时回退为整体 pathname 归一化。
function normalizePathSegments(href, config) {
  let p = String(href || '');
  try {
    const u = parseUrl(p);
    // 仅当是绝对 URL（有协议头）时才取 pathname
    if (u.protocol && /^https?:/i.test(u.protocol)) {
      p = u.pathname;
    }
  } catch (e) {
    // 相对路径，直接使用
  }

  // 若提供了 config，剥离 baseUrl 的 pathname 前缀
  if (config && config.baseUrl) {
    let basePath;
    try {
      basePath = (parseUrl(config.baseUrl).pathname || '/').replace(/\/+$/, '');
    } catch (e) {
      basePath = '';
    }
    if (basePath && p === basePath) p = '';
    else if (basePath && p.startsWith(basePath + '/')) p = p.slice(basePath.length);
  }

  // 解码百分号编码
  try { p = decodeURIComponent(p); } catch (e) { /* ignore */ }

  // 去掉首尾斜杠，得到纯路径段
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// 业务逻辑
// ---------------------------------------------------------------------------

// 列出目录：返回去重后的条目（排除当前目录自身）
function listDirectory(config, remotePath) {
  return webdavRequest({
    baseUrl: config.baseUrl,
    remotePath,
    username: config.username,
    password: decrypt(config.passwordEnc || ''),
    method: 'PROPFIND',
    depth: '1',
  }).then(function (result) {
    const items = parsePropfind(result.body);

    // 过滤：排除请求目录本身（href 指向当前目录自身的条目）
    // 服务器返回的 href 可能是相对路径或绝对路径，统一归一化为"路径段"后比较。
    const currentPathNormalized = normalizePathSegments(remotePath, config);
    const seen = new Set();
    const filtered = [];
    for (const item of items) {
      const hrefPath = normalizePathSegments(item.href, config);
      if (hrefPath === '' || hrefPath === currentPathNormalized) continue;
      if (seen.has(hrefPath)) continue;
      seen.add(hrefPath);
      filtered.push(item);
    }

    // 目录在前，文件在后，各自按名称排序
    filtered.sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return filtered;
  });
}

// 测试连接：请求根目录 Depth:0
function testConnection(config) {
  return webdavRequest({
    baseUrl: config.baseUrl,
    remotePath: '',
    username: config.username,
    password: decrypt(config.passwordEnc || ''),
    method: 'PROPFIND',
    depth: '0',
    timeout: CONNECT_TIMEOUT,
  }).then(function () {
    return true;
  });
}

// 下载文件（targetDir 为可选的自定义本地目录）
function downloadFile(config, remotePath, downloadId, fileName, targetDir) {
  const safeName = (fileName || path.basename(remotePath) || 'download')
    .replace(/[\\/:*?"<>|]/g, '_');

  // 确定下载目录：优先使用自定义目录，否则默认下载目录
  let destDir = DOWNLOAD_DIR;
  if (targetDir && String(targetDir).trim()) {
    destDir = String(targetDir).trim();
  }
  ensureDir(destDir);

  let finalName = safeName;
  let finalPath = path.join(destDir, finalName);
  // 若重名，追加序号
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    finalName = base + '(' + counter + ')' + ext;
    finalPath = path.join(destDir, finalName);
    counter++;
  }

  const tmpPath = finalPath + '.part';
  const ws = fs.createWriteStream(tmpPath);

  const startTime = Date.now();
  const job = {
    received: 0, total: 0, done: false, error: null,
    filePath: finalPath, fileName: finalName,
    startTime: startTime, destDir: destDir,
    paused: false, canceled: false,
  };
  // 控制对象：保存底层 req/res 引用，供取消/暂停
  const ctrl = {
    req: null, res: null,
    pause: null, resume: null, cancel: null,
  };
  job.ctrl = ctrl;
  downloadJobs.set(downloadId, job);

  return new Promise(function (resolve, reject) {
    webdavRequest({
      baseUrl: config.baseUrl,
      remotePath,
      username: config.username,
      password: decrypt(config.passwordEnc || ''),
      method: 'GET',
      timeout: DOWNLOAD_TIMEOUT,
      ctrl: ctrl,
      onData: function (chunk) {
        ws.write(chunk);
      },
      onProgress: function (p) {
        job.received = p.received;
        job.total = p.total;
      },
    })
      .then(function () {
        ws.end(function () {
          // 若已被取消，直接清理
          if (job.canceled) {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
            return resolve(job);
          }
          // 写入完成后重命名 .part -> 正式文件
          fs.renameSync(tmpPath, finalPath);
          const finishedAt = Date.now();
          job.done = true;
          job.filePath = finalPath;
          job.fileName = finalName;
          job.finishedAt = finishedAt;
          job.durationMs = finishedAt - startTime;
          // 写入下载历史（含完成时间、用时、来源服务器、文件管理器路径）
          try {
            const fm = toFileManagerPath(finalPath);
            const fmDir = toFileManagerPath(destDir);
            appendHistory({
              fileName: finalName,
              size: job.received || job.total || 0,
              destDir: destDir,
              relPath: fm ? fm.path : '',
              fmC: fm ? fm.c : null,
              fmPath: fm ? fm.path : '',
              fmDirC: fmDir ? fmDir.c : null,
              fmDirPath: fmDir ? fmDir.path : '',
              sourceServer: config.name || config.baseUrl || '',
              remotePath: remotePath || '',
              startedAt: new Date(startTime).toISOString(),
              finishedAt: new Date(finishedAt).toISOString(),
              durationMs: finishedAt - startTime,
            });
          } catch (e) {
            console.error('[history] 写入下载历史失败:', e.message);
          }
          resolve(job);
        });
      })
      .catch(function (err) {
        ws.destroy();
        // 清理残留 .part 文件
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (e) { /* ignore */ }
        if (job.canceled) {
          job.error = { code: 'canceled', message: '已取消下载' };
        } else {
          job.error = { code: err.code, message: err.message };
        }
        reject(err);
      });

    ws.on('error', function (err) {
      job.error = { code: 'write_failed', message: '写入本地文件失败：' + err.message };
    });
  });
}

// 将本地文件绝对路径转换为文件管理器导航参数 { c, path, dirPath }
// 规则：
//   /sata/public/xxx      -> c=10（公共目录）, path="public/xxx/"
//   /sata/home/admin/xxx  -> c=0（我的文件）, path="xxx/"
//   （不在上述根目录下时返回 null，无法用文件管理器打开）
function toFileManagerPath(absPath) {
  try {
    const target = path.resolve(absPath);
    const pub = path.resolve(LOCAL_ROOT);
    const home = path.resolve(HOME_ROOT);

    // 公共目录
    if (target === pub || target.indexOf(pub + path.sep) === 0) {
      const rel = target === pub ? '' : target.slice(pub.length + 1).split(path.sep).join('/');
      return { c: 10, path: 'public/' + (rel ? rel : '') };
    }
    // 我的文件
    if (target === home || target.indexOf(home + path.sep) === 0) {
      const rel = target === home ? '' : target.slice(home.length + 1).split(path.sep).join('/');
      return { c: 0, path: rel ? rel : '/' };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP 服务（JSON API）
// ---------------------------------------------------------------------------

const server = http.createServer(function (req, res) {
  // CORS（便于前端与后端分离调试，同源部署时可关闭）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // 静态文件服务（前端页面）
  if (req.method === 'GET' && pathname.indexOf('/api/') !== 0) {
    return serveStatic(req, res, pathname);
  }

  // ---------- API 路由 ----------
  readBody(req).then(function (body) {
    // 应用版本信息（供首页标题角标显示）
    if (req.method === 'GET' && pathname === '/api/version') {
      return sendJson(res, 200, { ok: true, version: readAppVersion() });
    }

    // 获取服务器列表
    if (req.method === 'GET' && pathname === '/api/servers') {
      const cfg = loadConfig();
      return sendJson(res, 200, { ok: true, servers: cfg.servers.map(publicConfig) });
    }

    // 获取单个服务器详情（含明文密码，供编辑回填）
    if (req.method === 'GET' && pathname === '/api/server') {
      const id = parsed.query.id;
      const cfg = loadConfig();
      const srv = cfg.servers.find(function (s) { return s.id === id; });
      if (!srv) return sendJson(res, 404, { ok: false, error: '服务器不存在' });
      return sendJson(res, 200, { ok: true, server: {
        id: srv.id, name: srv.name, baseUrl: srv.baseUrl, username: srv.username,
        password: decrypt(srv.passwordEnc || ''),
      }});
    }

    // 新增服务器
    if (req.method === 'POST' && pathname === '/api/server/add') {
      const baseUrl = body && body.baseUrl;
      if (!baseUrl) return sendJson(res, 400, { ok: false, error: '服务器地址不能为空' });
      const cfg = loadConfig();
      const now = new Date().toISOString();
      const srv = {
        id: crypto.randomBytes(8).toString('hex'),
        name: (body.name || '').trim() || (body.username || 'WebDAV'),
        baseUrl: normalizeBaseUrl(baseUrl),
        username: (body.username || '').trim(),
        passwordEnc: body.password ? encrypt(body.password) : '',
        createdAt: now,
        updatedAt: now,
      };
      cfg.servers.push(srv);
      saveConfig(cfg);
      return sendJson(res, 200, { ok: true, server: publicConfig(srv) });
    }

    // 更新服务器
    if (req.method === 'POST' && pathname === '/api/server/update') {
      const id = body && body.id;
      const baseUrl = body && body.baseUrl;
      if (!id) return sendJson(res, 400, { ok: false, error: '缺少服务器 id' });
      if (!baseUrl) return sendJson(res, 400, { ok: false, error: '服务器地址不能为空' });
      const cfg = loadConfig();
      const srv = cfg.servers.find(function (s) { return s.id === id; });
      if (!srv) return sendJson(res, 404, { ok: false, error: '服务器不存在' });
      srv.name = (body.name || '').trim() || (body.username || 'WebDAV');
      srv.baseUrl = normalizeBaseUrl(baseUrl);
      srv.username = (body.username || '').trim();
      // 密码留空表示不修改
      if (body.password !== undefined && body.password !== '') {
        srv.passwordEnc = encrypt(body.password);
      }
      srv.updatedAt = new Date().toISOString();
      saveConfig(cfg);
      return sendJson(res, 200, { ok: true, server: publicConfig(srv) });
    }

    // 删除服务器
    if (req.method === 'POST' && pathname === '/api/server/delete') {
      const id = body && body.id;
      if (!id) return sendJson(res, 400, { ok: false, error: '缺少服务器 id' });
      const cfg = loadConfig();
      const before = cfg.servers.length;
      cfg.servers = cfg.servers.filter(function (s) { return s.id !== id; });
      if (cfg.servers.length === before) return sendJson(res, 404, { ok: false, error: '服务器不存在' });
      saveConfig(cfg);
      return sendJson(res, 200, { ok: true });
    }

    // 浏览本地存储目录（供下载路径选择）
    // root 参数：public（公共目录 /sata/public，默认）| home（我的文件 /sata/home/admin）
    if (req.method === 'GET' && pathname === '/api/local/dirs') {
      const rootType = parsed.query.root === 'home' ? 'home' : 'public';
      const base = path.resolve(rootType === 'home' ? HOME_ROOT : LOCAL_ROOT);
      let rel = String(parsed.query.path || '').replace(/^\/+/, '').replace(/\/+$/, '');
      let target = base;
      if (rel) {
        target = path.resolve(base, rel);
        // 防止越界访问根目录之外
        if (target !== base && target.indexOf(base + path.sep) !== 0) {
          return sendJson(res, 400, { ok: false, error: '路径越界' });
        }
      }
      const result = listLocalDirs(target, rel, rootType);
      return sendJson(res, 200, result);
    }

    // 测试连接
    if (req.method === 'POST' && pathname === '/api/test') {
      const config = getRuntimeConfig(body);
      return testConnection(config).then(function () {
        sendJson(res, 200, { ok: true, message: '连接成功' });
      }).catch(function (err) {
        handleApiError(err, pathname, res);
      });
    }

    // 列出目录
    if (req.method === 'POST' && pathname === '/api/list') {
      const config = getRuntimeConfig(body);
      const remotePath = (body && body.path) || '';
      return listDirectory(config, remotePath).then(function (items) {
        sendJson(res, 200, { ok: true, path: remotePath, items: items });
      }).catch(function (err) {
        handleApiError(err, pathname, res);
      });
    }

    // 开始下载
    if (req.method === 'POST' && pathname === '/api/download') {
      const config = getRuntimeConfig(body);
      const remotePath = (body && body.path) || '';
      const fileName = body && body.fileName;
      const localDir = body && body.localDir;
      const downloadId = crypto.randomBytes(8).toString('hex');

      // 异步下载，不阻塞响应
      downloadFile(config, remotePath, downloadId, fileName, localDir)
        .catch(function (err) {
          console.error('[download] 任务失败:', downloadId, (err && err.message) || err);
        });

      return sendJson(res, 200, { ok: true, downloadId: downloadId });
    }

    // 查询下载进度
    if (req.method === 'GET' && pathname === '/api/download/progress') {
      const downloadId = parsed.query.id;
      const job = downloadJobs.get(downloadId);
      if (!job) return sendJson(res, 404, { ok: false, error: '下载任务不存在' });
      return sendJson(res, 200, {
        ok: true,
        received: job.received,
        total: job.total,
        done: job.done,
        error: job.error,
        filePath: job.filePath,
        fileName: job.fileName,
        paused: !!job.paused,
        canceled: !!job.canceled,
        finishedAt: job.finishedAt || null,
        durationMs: job.durationMs || null,
      });
    }

    // 取消下载
    if (req.method === 'POST' && pathname === '/api/download/cancel') {
      const downloadId = body && body.id;
      const job = downloadJobs.get(downloadId);
      if (!job) return sendJson(res, 404, { ok: false, error: '下载任务不存在' });
      job.canceled = true;
      job.paused = false;
      if (job.ctrl && job.ctrl.cancel) job.ctrl.cancel();
      return sendJson(res, 200, { ok: true });
    }

    // 暂停下载
    if (req.method === 'POST' && pathname === '/api/download/pause') {
      const downloadId = body && body.id;
      const job = downloadJobs.get(downloadId);
      if (!job) return sendJson(res, 404, { ok: false, error: '下载任务不存在' });
      job.paused = true;
      if (job.ctrl && job.ctrl.pause) job.ctrl.pause();
      return sendJson(res, 200, { ok: true, paused: true });
    }

    // 继续下载
    if (req.method === 'POST' && pathname === '/api/download/resume') {
      const downloadId = body && body.id;
      const job = downloadJobs.get(downloadId);
      if (!job) return sendJson(res, 404, { ok: false, error: '下载任务不存在' });
      job.paused = false;
      if (job.ctrl && job.ctrl.resume) job.ctrl.resume();
      return sendJson(res, 200, { ok: true, paused: false });
    }

    // 列出本地已下载文件（支持 dir 参数指定目录）
    if (req.method === 'GET' && pathname === '/api/downloads') {
      let listDir = DOWNLOAD_DIR;
      if (parsed.query.dir && String(parsed.query.dir).trim()) {
        listDir = String(parsed.query.dir).trim();
      }
      let files = [];
      try {
        ensureDir(listDir);
        files = fs.readdirSync(listDir)
          .filter(function (f) { return f.indexOf('.part') === -1; })
          .map(function (f) {
            const p = path.join(listDir, f);
            const st = fs.statSync(p);
            const fm = toFileManagerPath(p);
            return {
              name: f,
              size: st.size,
              mtime: st.mtime.toISOString(),
              path: p,
              relPath: fm ? fm.path : '',
              fmC: fm ? fm.c : null,
              fmPath: fm ? fm.path : '',
            };
          })
          .sort(function (a, b) { return a.mtime < b.mtime ? 1 : -1; });
      } catch (e) {
        files = [];
      }
      return sendJson(res, 200, { ok: true, dir: listDir, files: files });
    }

    // 获取下载历史记录（含完成时间、用时）
    if (req.method === 'GET' && pathname === '/api/download/history') {
      const history = loadHistory();
      return sendJson(res, 200, { ok: true, history: history });
    }

    // 清空下载历史记录（可选 deleteFiles=true 同时删除本地文件）
    if (req.method === 'POST' && pathname === '/api/download/history/clear') {
      const deleteFiles = !!(body && body.deleteFiles);
      const history = loadHistory();
      let deletedCount = 0;
      if (deleteFiles) {
        for (const rec of history) {
          if (!rec.destDir || !rec.fileName) continue;
          const fp = path.join(rec.destDir, rec.fileName);
          try {
            if (fs.existsSync(fp)) {
              fs.unlinkSync(fp);
              deletedCount++;
            }
          } catch (e) { /* ignore */ }
        }
      }
      saveHistory([]);
      return sendJson(res, 200, { ok: true, deletedCount: deletedCount });
    }

    // 读取下载目录配置
    if (req.method === 'GET' && pathname === '/api/config/download-dir') {
      return sendJson(res, 200, { ok: true, dir: loadDownloadDir(), defaultDir: DOWNLOAD_DIR });
    }

    // 保存下载目录配置
    if (req.method === 'POST' && pathname === '/api/config/download-dir') {
      const dir = body && body.dir;
      saveDownloadDir(dir || '');
      return sendJson(res, 200, { ok: true, dir: loadDownloadDir() });
    }

    return sendJson(res, 404, { ok: false, error: '接口不存在：' + pathname });
  }).catch(function (err) {
    handleApiError(err, pathname, res);
  });
});

// 统一处理 API 错误
function handleApiError(err, pathname, res) {
  console.error('[api]', pathname, '错误:', err.code, err.message);
  const status = mapErrorToStatus(err);
  return sendJson(res, status, { ok: false, code: err.code || 'unknown', error: err.message || '未知错误' });
}

// 获取运行时配置：优先按 serverId 或 body 内联配置，否则读取默认（第一个）服务器
function getRuntimeConfig(body) {
  const cfg = loadConfig();
  const serverId = body && (body.serverId || body.id);

  // 按 id 查找已保存的服务器
  if (serverId) {
    const srv = cfg.servers.find(function (s) { return s.id === serverId; });
    if (srv) {
      return {
        id: srv.id,
        name: srv.name,
        baseUrl: srv.baseUrl,
        username: srv.username,
        passwordEnc: srv.passwordEnc || '',
      };
    }
  }

  // 内联配置（测试连接等场景，来自表单临时填写）
  if (body && body.baseUrl) {
    return {
      baseUrl: normalizeBaseUrl(body.baseUrl),
      username: body.username || '',
      passwordEnc: body.password ? encrypt(body.password) : (body.passwordEnc || ''),
    };
  }

  // 回退：使用第一个已保存的服务器
  if (cfg.servers.length > 0) {
    const srv = cfg.servers[0];
    return {
      id: srv.id,
      name: srv.name,
      baseUrl: srv.baseUrl,
      username: srv.username,
      passwordEnc: srv.passwordEnc || '',
    };
  }

  const e = new Error('尚未保存连接配置，请先添加服务器');
  e.code = 'no_config';
  throw e;
}

// 对外返回的服务器信息（隐藏密码明文与加密串）
function publicConfig(config) {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    username: config.username,
    hasPassword: !!(config.passwordEnc && config.passwordEnc !== ''),
  };
}

// 枚举本地目录（用于下载路径选择）。返回子目录列表、当前路径、根目录绝对路径。
function listLocalDirs(absDir, relPath, rootType) {
  const dirs = [];
  const curRel = relPath || '';
  const rootAbs = rootType === 'home' ? path.resolve(HOME_ROOT) : path.resolve(LOCAL_ROOT);
  try {
    if (!fs.existsSync(absDir)) {
      return { ok: true, path: curRel, root: rootAbs, rootType: rootType, dirs: [], error: '目录不存在' };
    }
    const entries = fs.readdirSync(absDir);
    for (const name of entries) {
      const full = path.join(absDir, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch (e) { continue; }
      if (!isDir) continue;
      // 隐藏目录（.开头）不展示
      if (name.charAt(0) === '.') continue;
      const rel = curRel ? (curRel + '/' + name) : name;
      dirs.push({ name: name, path: rel, abs: full });
    }
    dirs.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); });
  } catch (e) {
    return { ok: true, path: curRel, root: rootAbs, rootType: rootType, dirs: [], error: '无法读取目录：' + e.message };
  }
  return { ok: true, path: curRel, root: rootAbs, rootType: rootType, dirs: dirs };
}

function mapErrorToStatus(err) {
  switch (err.code) {
    case 'auth_failed': return 401;
    case 'not_found': return 404;
    case 'no_config': return 400;
    case 'timeout': return 408;
    case 'invalid_url': return 400;
    default: return 502;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data) return resolve(null);
      if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
      try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 静态文件服务（前端）
// OneOS 打包后前端位于 web/ 目录；本地开发时位于 public/ 目录，优先使用 web/
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'web'))
  ? path.join(__dirname, 'web')
  : path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' || pathname === '' ? '/index.html' : pathname;
  // 防止路径穿越
  const safe = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!safe.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(safe, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(safe).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// 启动
ensureDir(path.dirname(CONFIG_FILE));
ensureDir(DOWNLOAD_DIR);
server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  X3P WebDAV 客户端已启动');
  console.log(`  监听地址: http://${HOST}:${PORT}`);
  console.log(`  配置目录: ${path.dirname(CONFIG_FILE)}`);
  console.log(`  下载目录: ${DOWNLOAD_DIR}`);
  console.log('==============================================');
});

server.on('error', (err) => {
  console.error('服务启动失败:', err.message);
});
