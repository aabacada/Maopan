#!/bin/sh
# =============================================================
#  X3P WebDAV 应用 —— 一键部署脚本
#  用法：将本脚本与 webdav.app 放到同一目录，然后执行：
#        sh deploy.sh
#  作用：解压 webdav.app 到 /sata/app/webdav/ 并通过应用中心协议启动
# =============================================================

set -e

APP_PACK="webdav"
INSTALLDIR="/sata/app"
TARGET_DIR="$INSTALLDIR/$APP_PACK"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_FILE="$SCRIPT_DIR/$APP_PACK.app"
PORT=8899

echo "=============================================="
echo "  X3P WebDAV 应用部署"
echo "=============================================="

# 1. 检查安装包
if [ ! -f "$APP_FILE" ]; then
  echo "[错误] 未找到 $APP_FILE"
  echo "请确认 webdav.app 与本脚本在同一目录。"
  exit 1
fi

# 2. 检查 Node.js 运行环境
echo ""
echo "[1/5] 检查 Node.js 运行环境 ..."
NODE_BIN=""
for c in node /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then
    NODE_BIN="$(command -v "$c")"
    break
  fi
  if [ -x "$c" ]; then
    NODE_BIN="$c"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "[错误] 未检测到 Node.js 运行时！"
  echo "  请先安装 Node.js (ARM64)，参考部署说明文档。"
  exit 1
fi
NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo '未知')"
echo "  Node.js 可用：$NODE_BIN ($NODE_VER)"

# 3. 解压应用
echo ""
echo "[2/5] 解压应用到 $TARGET_DIR ..."
mkdir -p "$TARGET_DIR"
tar -xf "$APP_FILE" -C "$INSTALLDIR/"
if [ ! -f "$TARGET_DIR/server.js" ]; then
  echo "[错误] 解压后未找到 server.js，包结构异常。"
  exit 1
fi
echo "  解压完成"

# 4. 配置控制脚本（确保 on/off/stat/del 存在且可执行）
echo ""
echo "[3/5] 配置控制脚本 ..."
chmod +x "$TARGET_DIR/app/app.sh" 2>/dev/null || true
chmod +x "$TARGET_DIR/bin/start.sh" 2>/dev/null || true
chmod +x "$TARGET_DIR/bin/stop.sh" 2>/dev/null || true
cd "$TARGET_DIR/app"
# 确保 on/off/stat/del 存在（包内已包含，这里兜底复制）
for s in on off stat del; do
  if [ ! -f "$s.sh" ]; then
    cp app.sh "$s.sh"
  fi
  chmod +x "$s.sh"
done
cd "$SCRIPT_DIR"
echo "  完成"

# 5. 启动服务（通过应用中心协议 on.sh）
echo ""
echo "[4/5] 启动服务 ..."
"$TARGET_DIR/app/on.sh"
echo "  已调用 on.sh"

# 6. 验证
echo ""
echo "[5/5] 验证服务 ..."
sleep 2
LOCAL_IP="$(ip addr show 2>/dev/null | grep -oE 'inet [0-9.]+' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')"
[ -z "$LOCAL_IP" ] && LOCAL_IP="<大猫盘IP>"

STATUS="$("$TARGET_DIR/app/stat.sh")"
echo "  服务状态: $STATUS"

if [ "$STATUS" = "on" ]; then
  echo ""
  echo "=============================================="
  echo "  ✅ 部署成功！"
  echo "  访问地址: http://$LOCAL_IP:$PORT"
  echo "  日志文件: $TARGET_DIR/webdav.log"
  echo "=============================================="
else
  echo ""
  echo "  ⚠️  服务可能未成功启动，请查看日志："
  echo "  cat $TARGET_DIR/webdav.log"
  echo "=============================================="
fi
