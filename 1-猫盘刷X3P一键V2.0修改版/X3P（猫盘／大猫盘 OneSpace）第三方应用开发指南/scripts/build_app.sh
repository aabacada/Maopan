#!/bin/sh
# =============================================================
#  X3P 第三方应用通用打包脚本模板
#  用法：sh build_app.sh
#  产出：dist/<APP_NAME>.app（tar 归档，扩展名 .app）
#
#  使用前修改以下变量：
#    APP_NAME  应用包名（= 目录名，唯一标识）
#  目录约定（项目根）：
#    app/conf.js         元数据
#    app/app.sh          控制脚本（on/off/stat/del 复制它）
#    app/app.png         图标（100×100 透明画布 + 70×70 图标居中）
#    bin/start.sh stop.sh
#    public/             前端（打包到 web/）
#    server.js           后端
# =============================================================

APP_NAME="webdav"        # TODO: 改成你的应用包名
OUT_DIR="dist"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$ROOT/.build_tmp"

rm -rf "$TMP" "$ROOT/$OUT_DIR"
mkdir -p "$TMP/$APP_NAME/app" "$TMP/$APP_NAME/bin" "$TMP/$APP_NAME/web" "$ROOT/$OUT_DIR"

# app/ 目录：元数据 + 控制脚本 + 图标
cp "$ROOT/app/conf.js" "$TMP/$APP_NAME/app/conf.js"
cp "$ROOT/app/app.sh" "$TMP/$APP_NAME/app/app.sh"
cp "$ROOT/app/app.png" "$TMP/$APP_NAME/app/app.png"
chmod +x "$TMP/$APP_NAME/app/app.sh"

# on/off/stat/del 控制脚本（Windows 环境无法软链，app.sh 靠 $0 自适应，复制即可）
for s in on off stat del; do
  cp "$TMP/$APP_NAME/app/app.sh" "$TMP/$APP_NAME/app/$s.sh"
done

# bin/ 目录：启停脚本
cp "$ROOT/bin/start.sh" "$TMP/$APP_NAME/bin/start.sh"
cp "$ROOT/bin/stop.sh" "$TMP/$APP_NAME/bin/stop.sh"
chmod +x "$TMP/$APP_NAME/bin/start.sh" "$TMP/$APP_NAME/bin/stop.sh"

# web/ 目录：前端页面
cp "$ROOT/public/index.html" "$TMP/$APP_NAME/web/index.html"
cp "$ROOT/public/style.css" "$TMP/$APP_NAME/web/style.css"
cp "$ROOT/public/app.js" "$TMP/$APP_NAME/web/app.js"

# 后端服务
cp "$ROOT/server.js" "$TMP/$APP_NAME/server.js"
[ -f "$ROOT/package.json" ] && cp "$ROOT/package.json" "$TMP/$APP_NAME/package.json"

# 打包为 tar 归档（扩展名 .app）
echo "[build] 打包为 .app ..."
cd "$TMP"
tar -cf "$ROOT/$OUT_DIR/${APP_NAME}.app" "$APP_NAME"
cd "$ROOT"

rm -rf "$TMP"

echo "[build] 完成：$ROOT/$OUT_DIR/${APP_NAME}.app"
ls -la "$ROOT/$OUT_DIR/"
