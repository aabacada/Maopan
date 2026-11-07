#!/bin/sh
# OneOS (猫盘 X3P) WebDAV 应用打包脚本
# 用法：sh build.sh
# 产出：dist/webdav.app
#
# 基于官方第三方应用 verysync 反推的真实 X3P 应用结构：
#   /sata/app/<pack>/
#     app/conf.js     元数据
#     app/app.sh      控制脚本（on.sh/off.sh/stat.sh/del.sh 软链到它）
#     app/app.png     图标
#     bin/start.sh    启动脚本
#     bin/stop.sh     停止脚本
#     web/            前端（web 应用时）
#     server.js       后端

APP_NAME="webdav"
OUT_DIR="dist"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$ROOT/.build_tmp"

rm -rf "$TMP" "$ROOT/$OUT_DIR"
mkdir -p "$TMP/webdav/app" "$TMP/webdav/bin" "$TMP/webdav/web" "$ROOT/$OUT_DIR"

# app/ 目录：元数据 + 控制脚本 + 图标
cp "$ROOT/app/conf.js" "$TMP/webdav/app/conf.js"
cp "$ROOT/app/app.sh" "$TMP/webdav/app/app.sh"
cp "$ROOT/app/app.png" "$TMP/webdav/app/app.png"
chmod +x "$TMP/webdav/app/app.sh"

# 创建 on/off/stat/del 控制脚本（app.sh 靠 basename $0 判断动作，复制即可）
# 注：Windows 开发环境不支持软链接，故用复制；app.sh 内容已通过 $0 自适应
cp "$TMP/webdav/app/app.sh" "$TMP/webdav/app/on.sh"
cp "$TMP/webdav/app/app.sh" "$TMP/webdav/app/off.sh"
cp "$TMP/webdav/app/app.sh" "$TMP/webdav/app/stat.sh"
cp "$TMP/webdav/app/app.sh" "$TMP/webdav/app/del.sh"

# bin/ 目录：启停脚本
cp "$ROOT/bin/start.sh" "$TMP/webdav/bin/start.sh"
cp "$ROOT/bin/stop.sh" "$TMP/webdav/bin/stop.sh"
chmod +x "$TMP/webdav/bin/start.sh" "$TMP/webdav/bin/stop.sh"

# web/ 目录：前端页面
cp "$ROOT/public/index.html" "$TMP/webdav/web/index.html"
cp "$ROOT/public/style.css" "$TMP/webdav/web/style.css"
cp "$ROOT/public/app.js" "$TMP/webdav/web/app.js"

# 后端服务
cp "$ROOT/server.js" "$TMP/webdav/server.js"
cp "$ROOT/package.json" "$TMP/webdav/package.json"

# 打包为 tar 归档（扩展名 .app）
# --owner/--group + --numeric-owner：把归档内的属主统一写成 0/0，
# 避免把打包机器的本机用户名带进安装包。
echo "[build] 打包为 .app ..."
cd "$TMP"
tar -cf "$ROOT/$OUT_DIR/${APP_NAME}.app" --owner=0 --group=0 --numeric-owner webdav 2>/dev/null \
  || tar -cf "$ROOT/$OUT_DIR/${APP_NAME}.app" webdav
cd "$ROOT"

rm -rf "$TMP"

echo "[build] 完成：$ROOT/$OUT_DIR/${APP_NAME}.app"
ls -la "$ROOT/$OUT_DIR/"
