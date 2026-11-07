# 打包、SSH 部署与验证流程

## 一、打包（build_app.sh）

`.app` 文件实际是一个 **tar 归档**（扩展名 `.app`），内部包含应用根目录。

```sh
#!/bin/sh
APP_NAME="webdav"
OUT_DIR="dist"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$ROOT/.build_tmp"

rm -rf "$TMP" "$ROOT/$OUT_DIR"
mkdir -p "$TMP/$APP_NAME/app" "$TMP/$APP_NAME/bin" "$TMP/$APP_NAME/web" "$ROOT/$OUT_DIR"

# app/ 元数据 + 控制脚本 + 图标
cp "$ROOT/app/conf.js" "$TMP/$APP_NAME/app/conf.js"
cp "$ROOT/app/app.sh" "$TMP/$APP_NAME/app/app.sh"
cp "$ROOT/app/app.png" "$TMP/$APP_NAME/app/app.png"
chmod +x "$TMP/$APP_NAME/app/app.sh"

# on/off/stat/del 用复制（Windows 无法软链，app.sh 靠 $0 自适应）
for s in on off stat del; do cp "$TMP/$APP_NAME/app/app.sh" "$TMP/$APP_NAME/app/$s.sh"; done

# bin/ 启停脚本
cp "$ROOT/bin/start.sh" "$TMP/$APP_NAME/bin/start.sh"
cp "$ROOT/bin/stop.sh" "$TMP/$APP_NAME/bin/stop.sh"
chmod +x "$TMP/$APP_NAME/bin/start.sh" "$TMP/$APP_NAME/bin/stop.sh"

# web/ 前端
cp "$ROOT/public/index.html" "$TMP/$APP_NAME/web/index.html"
cp "$ROOT/public/style.css" "$TMP/$APP_NAME/web/style.css"
cp "$ROOT/public/app.js" "$TMP/$APP_NAME/web/app.js"

# 后端
cp "$ROOT/server.js" "$TMP/$APP_NAME/server.js"
cp "$ROOT/package.json" "$TMP/$APP_NAME/package.json"

# 打包为 tar 归档
cd "$TMP"
tar -cf "$ROOT/$OUT_DIR/${APP_NAME}.app" "$APP_NAME"
cd "$ROOT"
rm -rf "$TMP"
```

要点：
- `tar -cf` 从 `$TMP` 目录打包 `$APP_NAME` 子目录，解压后直接得到 `<pack>/` 结构
- `chmod +x` 必须，否则设备上控制脚本不可执行
- Windows 环境用 `cp` 代替软链接创建 on/off/stat/del

## 二、SSH 部署（两种方式）

### 方式 A：上传 .app + 设备端解压（推荐，应用中心识别完整）

```bash
# 1. scp 上传 .app 到设备临时目录
scp $SCPOPTS dist/webdav.app root@IP:/tmp/

# 2. SSH 解压到 /sata/app/
ssh $SSHOPTS root@IP 'mkdir -p /sata/app/webdav && tar -xf /tmp/webdav.app -C /sata/app/'

# 3. 配置控制脚本权限并启动
ssh $SSHOPTS root@IP 'chmod +x /sata/app/webdav/app/*.sh /sata/app/webdav/bin/*.sh && sh /sata/app/webdav/app/on.sh'
```

### 方式 B：scp 逐文件上传（快速迭代，改动少时更高效）

```bash
scp $SCPOPTS server.js root@IP:/sata/app/webdav/server.js
scp $SCPOPTS public/index.html root@IP:/sata/app/webdav/web/index.html
scp $SCPOPTS public/style.css root@IP:/sata/app/webdav/web/style.css
scp $SCPOPTS public/app.js root@IP:/sata/app/webdav/web/app.js
scp $SCPOPTS app/app.png root@IP:/sata/app/webdav/app/app.png
scp $SCPOPTS app/conf.js root@IP:/sata/app/webdav/app/conf.js
```

迭代开发时，方式 B 只上传改动文件，比反复打包上传更快。`SCPOPTS`/`SSHOPTS` 见 environment.md 的 SSH 登录章节。

## 三、重启服务

```bash
ssh $SSHOPTS root@IP 'sh /sata/app/webdav/bin/stop.sh; sleep 2; sh /sata/app/webdav/bin/start.sh; sleep 3; sh /sata/app/webdav/app/stat.sh; tail -15 /sata/app/webdav/webdav.log'
```

- `stat.sh` 应输出 `on`（无换行）
- 排障看 `webdav.log`（`nohup` 重定向的日志）

## 四、验证清单

| 验证项 | 方法 |
|--------|------|
| 应用中心识别 | `curl -s "http://IP/oneapi/app?method=list"` 检查 pack/name/port 字段 |
| 应用中心图标 | `curl -s -o /dev/null -w "%{http_code} %{size_download}" "http://IP/app/thirdparty/<pack>/app/app.png"` |
| 服务状态 | `sh /sata/app/<pack>/app/stat.sh` 输出 `on` |
| 启停 | `sh .../app/off.sh` → stat 输出 `off` → `on.sh` → `on` |
| HTTP 访问 | `curl -s http://IP:8899/` 返回前端 HTML |
| 功能实测 | 用 curl 调用后端 API，验证完整业务链路 |

## 五、配置迁移与升级

迭代升级时，若配置格式变化（如单条→列表），需：

1. **备份旧配置**：`cp config/xxx.json config/xxx.json.bak`
2. **迁移格式**：手动或让后端 `loadConfig` 自动迁移（检测旧格式特征，转换后写回）
3. **保留敏感数据**：密码加密串等直接沿用，不丢失用户已保存的信息

示例（后端自动迁移）：

```js
function loadConfig() {
  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  // 兼容旧版单条配置 -> 迁移为列表
  if (data && data.baseUrl && !Array.isArray(data.servers)) {
    return { servers: [{ id: 'default', name: data.name || 'Default', baseUrl: data.baseUrl, username: data.username, passwordEnc: data.passwordEnc }] };
  }
  return data;
}
```

## 六、部署排障常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| stat 输出 off | 进程没起来或 PID 文件残留 | 看日志，删残留 pid 文件重启 |
| 上传 .app 到网页提示「升级包错误」 | `/oneapi/file/upgrade` 是固件升级通道，非应用安装通道 | 改用 SSH 部署 |
| `Invalid app name` | `install` 方法有内部白名单 | 只能 SSH 部署，应用中心自动扫描识别 |
| 图标不更新 | 浏览器缓存 | Ctrl+F5 强刷 |
| 中文目录/文件名乱码 | 编码问题 | 前后端统一 UTF-8，Node 用 `decodeURIComponent` |
